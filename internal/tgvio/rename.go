package tgvio

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	stdpath "path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Renaming a folder's videos after TMDB, so a library reads the same way
// everywhere: films become "片名 (年份).mkv", episodes "剧名 - S02E05 - 集名.mkv",
// subtitles follow their video, and the folder itself can become "片名 (年份)"
// or "剧名 第二季 (年份)". The plan is computed here and shown to the person
// first; nothing is renamed until they apply the rows they keep.

// RenameEntry is one object of the folder being planned.
type RenameEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size,omitempty"`
}

// RenameItem is one proposed rename.
type RenameItem struct {
	Old     string `json:"old"`
	New     string `json:"new,omitempty"`
	Kind    string `json:"kind"` // "video", "subtitle", "extra" (.nfo, -thumb.jpg), "folder", "junk", "unwrap"
	Season  int    `json:"season,omitempty"`
	Episode int    `json:"episode,omitempty"`
	Reason  string `json:"reason,omitempty"` // why there is no proposal
	Size    int64  `json:"size,omitempty"`   // for versions of one episode, to tell them apart
	// Action, for rows that are no rename: "delete" (an ad or leftover file,
	// kind "junk") or "unwrap" (a folder wrapped around the film: its contents
	// move up here and it goes, kind "unwrap").
	Action string `json:"action,omitempty"`
	// Into: a film of a folder of several goes into a folder of its own of this
	// name, made here ("流浪地球/流浪地球 (2019)/流浪地球 (2019).mkv").
	Into string `json:"into,omitempty"`
}

// RenamePlan is what the person reviews.
type RenamePlan struct {
	Subject *Poster      `json:"subject,omitempty"`
	Season  int          `json:"season,omitempty"` // the season the episodes were named under
	Items   []RenameItem `json:"items"`
	Reason  string       `json:"reason,omitempty"` // the whole folder could not be planned
	// Need is "season" when the series has several seasons and nothing says
	// which one this folder is: nothing is proposed until the person picks one.
	Need string `json:"need,omitempty"`
	// Inherited: the folder found nothing of its own (or is part of the series
	// above it) and is named after the folder above.
	Inherited bool `json:"inherited,omitempty"`
	// Film: the folder is one film's (not a series or a shelf of several):
	// what is below it is that film too.
	Film bool `json:"film,omitempty"`
	// Shelf: TMDB knows no film by the folder's name, but it holds films (a
	// collection of someone's films, a box of several series): planned film by
	// film; it keeps its name, and can spill its contents into the folder above.
	Shelf bool `json:"shelf,omitempty"`
	// SeriesFirst: the folder is named for a series; its earliest film (TMDB
	// id), recorded as the folder's cover when it is renamed.
	SeriesFirst int `json:"series_first,omitempty"`
}

// RenameInherit is what the folder above a subfolder was planned as, for
// subfolders that name nothing themselves ("Subs", "Season 2", "第五季").
type RenameInherit struct {
	Kind   string `json:"kind"`
	ID     int    `json:"id"`
	Season int    `json:"season,omitempty"`
	// Film: the folder above is one film's folder (RenamePlan.Film); a film
	// above that is a series or a shelf says nothing about its subfolders.
	Film bool `json:"film,omitempty"`
}

var (
	mediaExt    = regexp.MustCompile(`(?i)\.(mp4|mkv|avi|mov|wmv|flv|ts|m2ts|rmvb|webm|m4v|iso|mpg|mpeg|vob)$`)
	subtitleExt = regexp.MustCompile(`(?i)\.(srt|ass|ssa|vtt|sub|idx|sup|nfo)$`)
	badChars    = regexp.MustCompile(`[/\\:*?"<>|\x00-\x1f]+`)

	epSxxEyy  = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,4})(?:[^0-9]|$)`)
	epCN      = regexp.MustCompile(`第\s*(\d{1,4}|[一二三四五六七八九十百]{1,4})\s*[集话話]`)
	epTag     = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])(?:ep?|episode)[ ._-]?(\d{1,4})(?:[^0-9]|$)`)
	epBracket = regexp.MustCompile(`[\[【(（]\s*(\d{1,4})(?:v\d)?\s*(?:END|完)?\s*[\]】)）]`)
	epDash    = regexp.MustCompile(`\s-\s(\d{1,4})(?:v\d)?(?:\s|$|[\[(.])`)
	epBare    = regexp.MustCompile(`^(\d{1,4})$`)
	epTail    = regexp.MustCompile(`(?:^|[\s._\-])(\d{1,3})$`)
	// TMDB's stand-in for an episode with no title yet ("第 1 集", "Episode 1"): not worth a file name.
	placeholderTitle = regexp.MustCompile(`(?i)^(?:第\s*\d+\s*[集话話]|episode\s*\d+|ep\.?\s*\d+)$`)
	resolutionTag    = regexp.MustCompile(`(?i)\b(?:4320|2160|1440|1080|720|576|480)[pi]\b|\b[48]k\b`)
	// Artwork media servers keep beside a video ("…-thumb.jpg", "…-poster.png").
	companionImage = regexp.MustCompile(`(?i)-(?:thumb|poster|fanart|landscape|banner|clearart|logo|disc)\.(?:jpe?g|png|webp)$`)
	langTag        = regexp.MustCompile(`(?i)^(?:(?:en|eng|zh|chi|zho|chs|cht|sc|tc|gb|big5|ja|jp|jpn|ko|kor|fr|fre|de|ger|es|spa|ru|rus|it|pt|th|vi)(?:[-_](?:cn|tw|hk|hans|hant|sg|us|gb|br))?|forced|sdh|default|cc|(?:简|繁|中|英|日|韩|双语|体|文|字幕|[&+\-_])+)$`)
	partTag        = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])(?:cd|disc|disk|part|pt)[ ._-]?(\d{1,2})(?:[^0-9]|$)`)
	// What downloads bring besides the film: a release site's ad (".txt",
	// ".url", a page), a torrent client's padding file, a drive's half-uploaded
	// leftover (".x.mkv.baiduyun.uploading.cfg").
	junkSmall = regexp.MustCompile(`(?i)\.(?:txt|url|html?|mht|lnk|website)$`)
	junkAny   = regexp.MustCompile(`(?i)^_{3,}padding_file|\.(?:uploading|downloading)\.cfg$|\.(?:!qb|bc!|aria2|torrent)$|^(?:thumbs\.db|desktop\.ini|\.ds_store)$`)
	notEp     = regexp.MustCompile(`(?i)\b\d{3,4}p\b|[xh]\.?26[45]|\b(?:19|20)\d{2}\b|\b\d+bit\b|\bddp?\d\.\d\b|\b[257]\.1\b`)
)

// A release site's own ad, by its name: "更多电视剧集下载请访问 高清剧集网官网（www.DDHDTV.com）.png",
// "【更多无水印蓝光电影请访问 www.BBQDDQ.com】.DOC", "官方Telegram交流群@xxx.url". A film's own
// files (its video, artwork such as "poster.jpg") say none of this.
var adWords = regexp.MustCompile(`(?i)www\.|https?[:：]|\.(?:com|net|org|cc|me|tv|xyz|top|vip|cn)\b|下载|访问|官网|网址|地址|发布页|扫码|二维码|关注|公众号|交流群|电报群|telegram|t\.me|@|无水印|更多.{0,6}(?:电影|剧集|资源)`)

// adEpisode: a name with an episode in it is the title's own (ads never number episodes).
var adEpisode = regexp.MustCompile(`(?i)\bS\d{1,2}E\d{1,4}\b|第\s*\d+\s*[集话話期]`)

// adMax: an ad is small, whatever its kind (a picture, a note, a page, a
// document, a clip); a film's video is far larger, so a big file always stays.
const adMax = 20 << 20

// IsJunk reports whether a file is an ad or a leftover a download brought, not
// part of the film. One rule for any kind of file: a small file whose name
// advertises a site (subtitles excepted: their names often carry the
// subtitle site's address), and what downloads leave behind (padding files,
// unfinished uploads, torrents, Thumbs.db). Small notes and links without a
// site's name go too.
func IsJunk(e RenameEntry) bool {
	if e.IsDir {
		return false
	}
	switch {
	case junkAny.MatchString(e.Name):
		return true
	case subtitleExt.MatchString(e.Name), companionImage.MatchString(e.Name), adEpisode.MatchString(e.Name):
		// A subtitle, a film's or an episode's artwork ("…S01E720.完美的二维码比赛-thumb.jpg"), anything
		// named for an episode: its name is the title's, not an ad, whatever words it has.
		return false
	case adWords.MatchString(e.Name):
		return e.Size < adMax
	}
	return junkSmall.MatchString(e.Name) && e.Size < 64<<10
}

// seriesFolder names a folder of films of one series: what their titles
// share ("招魂", "招魂2", "招魂3" -> "招魂"), else the series' own name without
// its "系列" / "Collection".
func seriesFolder(titles []string, collection string) string {
	prefix := ""
	if len(titles) > 0 {
		prefix = titles[0]
		for _, t := range titles[1:] {
			a, b := []rune(prefix), []rune(t)
			i := 0
			for i < len(a) && i < len(b) && a[i] == b[i] {
				i++
			}
			prefix = string(a[:i])
		}
	}
	prefix = strings.TrimRight(prefix, " 0123456789:：·.-_（(【[之的与和")
	if prefix != "" {
		return SafeName(prefix)
	}
	name := collectionSuffix.ReplaceAllString(collection, "")
	return SafeName(name)
}

// collectionWord: a folder named as a collection of films.
var collectionWord = regexp.MustCompile(`(?i)合集|系列|全集|电影集|作品集|三部曲|套装|collection|trilogy`)

// releaseFolder: only files, a video or two (a release's own folder, not a shelf).
func releaseFolder(entries []RenameEntry) bool {
	videos := 0
	for _, e := range entries {
		if e.IsDir {
			return false
		}
		if mediaExt.MatchString(e.Name) {
			videos++
		}
	}
	return videos <= 2
}

func inheritedTV(inherit *RenameInherit) bool { return inherit != nil && inherit.Kind == "tv" }

// hasEpisodes: some video here is numbered as an episode.
func hasEpisodes(entries []RenameEntry) bool {
	for _, e := range entries {
		if !e.IsDir && mediaExt.MatchString(e.Name) {
			if _, ep := ParseEpisode(e.Name); ep > 0 {
				return true
			}
		}
	}
	return false
}

// isRoot: one of the library's own folders (its name is no film).
func (t *TMDB) isRoot(dir string) bool {
	for _, root := range t.Config().Paths {
		if dir == root {
			return true
		}
	}
	return false
}

var collectionSuffix = regexp.MustCompile(`(?i)\s*(?:[（(]?系列[）)]?|collection)\s*$`)

// ParseEpisode reads a season and an episode number from a video name (season 0
// when the name does not say). It ignores resolutions, codecs and years.
func ParseEpisode(name string) (season, episode int) {
	base := mediaExt.ReplaceAllString(strings.TrimSpace(name), "")
	if m := epSxxEyy.FindStringSubmatch(base); m != nil {
		season, _ = strconv.Atoi(m[1])
		episode, _ = strconv.Atoi(m[2])
		return season, episode
	}
	if m := epCN.FindStringSubmatch(base); m != nil {
		return SeasonOf(base), cnNumber(m[1])
	}
	clean := notEp.ReplaceAllString(base, " ")
	for _, re := range []*regexp.Regexp{epTag, epBracket, epDash} {
		if m := re.FindStringSubmatch(clean); m != nil {
			n, _ := strconv.Atoi(m[1])
			return SeasonOf(base), n
		}
	}
	trimmed := strings.TrimSpace(brackets.ReplaceAllString(clean, " "))
	if m := epBare.FindStringSubmatch(trimmed); m != nil {
		n, _ := strconv.Atoi(m[1])
		return 0, n
	}
	if m := epTail.FindStringSubmatch(trimmed); m != nil {
		n, _ := strconv.Atoi(m[1])
		return SeasonOf(base), n
	}
	return 0, 0
}

// SafeName makes a title usable as a file name on any drive.
func SafeName(s string) string {
	s = strings.NewReplacer(":", "：", "?", "？", "*", " ", "\"", "'", "<", "《", ">", "》", "|", " ").Replace(s)
	s = badChars.ReplaceAllString(s, " ")
	return strings.Trim(spaces.ReplaceAllString(s, " "), " .")
}

var cnDigits = []string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}

// cnNumeral writes 1..99 the way season folders are usually named: 二, 十二, 二十.
func cnNumeral(n int) string {
	switch {
	case n <= 0 || n >= 100:
		return strconv.Itoa(n)
	case n < 10:
		return cnDigits[n]
	case n == 10:
		return "十"
	case n < 20:
		return "十" + cnDigits[n%10]
	case n%10 == 0:
		return cnDigits[n/10] + "十"
	}
	return cnDigits[n/10] + "十" + cnDigits[n%10]
}

func titleYear(title string, year int) string {
	if year > 0 {
		return fmt.Sprintf("%s (%d)", title, year)
	}
	return title
}

func extOf(name string) string {
	if m := mediaExt.FindString(name); m != "" {
		return strings.ToLower(m)
	}
	return strings.ToLower(stdpath.Ext(name))
}

// ---------------------------------------------------------------- TMDB side

type tmdbEpisode struct {
	EpisodeNumber int     `json:"episode_number"`
	Name          string  `json:"name"`
	StillPath     string  `json:"still_path"`
	Overview      string  `json:"overview"`
	AirDate       string  `json:"air_date"`
	Runtime       int     `json:"runtime"`
	VoteAverage   float64 `json:"vote_average"`
}

var genericEpisode = regexp.MustCompile(`(?i)^(第\s*\d+\s*[集话話]|episode\s*\d+|エピソード\s*\d+|\d+)$`)

type seasonEpisodes struct {
	titles map[int]string
	stills map[int]string
	list   []tmdbEpisode // the whole season, for the series page
	ok     bool          // TMDB answered
}

// episodesMemo keeps one season's episodes: thumbnails ask for their names and
// stills on every folder visit.
var episodesMemo = newMemo[[]tmdbEpisode]("episodes") // "id/season/language"

func (t *TMDB) episodes(ctx context.Context, id, season int) *seasonEpisodes {
	key := fmt.Sprintf("%d/%d/%s", id, season, t.Config().Language)
	out := &seasonEpisodes{titles: map[int]string{}, stills: map[int]string{}}
	list, ordered := t.orderedEpisodes(ctx, id, season)
	var err error
	if !ordered {
		list, err = episodesMemo.fetch(ctx, key, func(ctx context.Context) ([]tmdbEpisode, error) {
			var s struct {
				Episodes []tmdbEpisode `json:"episodes"`
			}
			err := t.get(ctx, "tv/"+strconv.Itoa(id)+"/season/"+strconv.Itoa(season), url.Values{}, &s)
			return s.Episodes, err
		})
	}
	if err != nil {
		return out // not kept: asked again next time
	}
	out.list, out.ok = list, true
	for _, e := range list {
		if name := strings.TrimSpace(e.Name); name != "" && !genericEpisode.MatchString(name) {
			out.titles[e.EpisodeNumber] = name
		}
		if e.StillPath != "" {
			out.stills[e.EpisodeNumber] = e.StillPath
		}
	}
	return out
}

// episodeTitles reads the episode names of one season (missing or placeholder
// names are left out).
func (t *TMDB) episodeTitles(ctx context.Context, id, season int) map[int]string {
	return t.episodes(ctx, id, season).titles
}


// EpisodeStills finds TMDB's still image for the episode files of a folder that
// is a series (or one season of it). Only the poster store and TMDB are asked.
func (t *TMDB) EpisodeStills(ctx context.Context, dir string, names []string) map[string]string {
	out := map[string]string{}
	if !t.Enabled() || !t.Config().Enabled || !t.Covers(dir) || dir == "/" {
		return out
	}
	folder := pathBase(dir)
	t.mu.Lock()
	entry := t.entries[Key(folder)]
	if entry == nil {
		entry = t.entries[Key(pathBase(stdpath.Dir(dir))+" "+folder)]
	}
	t.mu.Unlock()
	if entry == nil || entry.None || entry.Kind != "tv" {
		return out
	}
	folderSeason := entry.Season
	if folderSeason == 0 {
		folderSeason = SeasonOf(folder)
	}
	seasons := t.cachedSeasons(ctx, entry.ID)
	counts, last := map[int]int{}, 0
	for _, s := range seasons {
		counts[s.Season] = s.Episodes
		if s.Season > last {
			last = s.Season
		}
	}
	for _, name := range names {
		if !mediaExt.MatchString(name) {
			continue
		}
		s, ep := ParseEpisode(name)
		if ep == 0 {
			continue
		}
		explicit := s > 0
		switch {
		case folderSeason > 0:
			s = folderSeason
		case s == 0:
			s = 1
		}
		s, ep = placeEpisode(counts, last, s, ep, explicit)
		if still := t.episodes(ctx, entry.ID, s).stills[ep]; still != "" {
			out[name] = still
		}
	}
	return out
}

// resolve answers a name from the store, or looks it up now and stores it.
func (t *TMDB) resolve(ctx context.Context, name, in string) (*Poster, error) {
	t.mu.Lock()
	entry := t.entries[Key(name)]
	t.mu.Unlock()
	// Kept: a choice made by hand, or a match found by the current rules. A
	// match found by older rules is looked up again (it may have been wrong).
	t.mu.Lock()
	stray := t.strayLocked(in, name, entry)
	t.mu.Unlock()
	if entry != nil && !stray && (entry.Manual || !entry.None && entry.Rev >= cleanerRev) {
		return entry, nil
	}
	p, err := t.lookupIn(ctx, name, in)
	if err != nil {
		return nil, err
	}
	p.Name, p.Dir = name, in
	t.mu.Lock()
	if cur := t.entries[Key(name)]; cur == nil || !cur.Manual {
		t.entries[Key(name)] = p
	}
	t.mu.Unlock()
	t.save()
	return p, nil
}

// subjectOf finds what a folder is about: its own poster entry, or (for a folder
// named unlike its film) the one film its videos agree on. Lookups made here
// are stored like background ones.
func (t *TMDB) subjectOf(ctx context.Context, dir string, entries []RenameEntry) (*Poster, error) {
	folder := pathBase(dir)
	look := folder
	if query, _, _, _ := CleanName(folder); query == "" && SeasonOf(folder) > 0 {
		look = pathBase(stdpath.Dir(dir)) + " " + folder
	}
	p, err := t.resolve(ctx, look, stdpath.Dir(dir))
	if err != nil {
		return nil, err
	}
	if !p.None {
		return p, nil
	}
	// The folder found nothing: ask its videos (a few at most).
	var found *Poster
	asked := 0
	for _, e := range entries {
		if e.IsDir || !mediaExt.MatchString(e.Name) || Skip(e.Name) || asked >= 4 {
			continue
		}
		asked++
		fp, err := t.resolve(ctx, e.Name, dir)
		if err != nil {
			return nil, err
		}
		if fp.None {
			continue
		}
		if found != nil && (found.ID != fp.ID || found.Kind != fp.Kind) {
			return p, nil // the videos disagree: nothing to go by
		}
		found = fp
	}
	if found != nil {
		if asked == 1 {
			t.mu.Lock()
			t.inheritLocked(dir, found)
			t.mu.Unlock()
			t.save()
		}
		return found, nil
	}
	return p, nil
}

// PlanRename proposes TMDB names for a folder's videos, their subtitles and the
// folder itself. dir is the folder's real path; entries are its contents.
// season > 0 names the season by hand (the plan's season picker); 0 reads it
// from the folder's poster or name.
func (t *TMDB) PlanRename(ctx context.Context, dir string, entries []RenameEntry, season int) (*RenamePlan, error) {
	return t.PlanRenameIn(ctx, dir, entries, season, nil)
}

// PlanRenameIn plans a folder inside one already planned (a subfolder of a
// series or film being renamed as a whole). A subfolder of a series is always
// part of that series, whatever its own name finds ("Featurettes" is no film of
// its own); a subfolder of a film folder keeps its own match when it has one.
func (t *TMDB) PlanRenameIn(ctx context.Context, dir string, entries []RenameEntry, season int, inherit *RenameInherit) (*RenamePlan, error) {
	if !t.Enabled() {
		return nil, errors.New("TMDB is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	subject, err := t.subjectOf(ctx, dir, entries)
	if err != nil {
		return nil, err
	}
	plan := &RenamePlan{Items: []RenameItem{}}
	// A folder named like no film ("[DBD-Raws][潜伏3][1080P]…", a release's own
	// folder) inside a film's folder is that film. Asked before what the folders
	// further up were planned as: that may be a whole series of films.
	if up := stdpath.Dir(dir); subject.None && inherit == nil && up != "/" && !Skip(pathBase(up)) && !t.isRoot(up) && releaseFolder(entries) {
		if p, err := t.resolve(ctx, pathBase(up), stdpath.Dir(up)); err == nil && !p.None && p.Kind == "movie" {
			subject, plan.Inherited = p, true
		}
	}
	ownSeason := true
	// Below a series everything is that series; below one film's folder everything
	// is that film, whatever its own name finds ("[DBD-Raws][潜伏3]…" can find
	// the series' first film, "q伏2.2013…" another). Below a shelf, nothing.
	if inherit != nil && inherit.ID > 0 && (subject.None || subject.ID != inherit.ID || subject.Kind != inherit.Kind) &&
		(inherit.Kind == "tv" || inherit.Kind == "movie" && inherit.Film) {
		above, err := t.Details(ctx, inherit.Kind, inherit.ID)
		if err != nil {
			return nil, err
		}
		subject, ownSeason, plan.Inherited = above, false, true
	}
	folder := pathBase(dir)
	shelf := false
	// "生化危机合集", "复仇者联盟系列": films, whatever the name finds (a series of the same name).
	if !subject.None && collectionWord.MatchString(folder) && !inheritedTV(inherit) && !hasEpisodes(entries) {
		subject = &Poster{None: true}
	}
	if subject.None {
		// Several videos or folders under a name TMDB does not know: a shelf.
		loose, dirs := 0, 0
		for _, e := range entries {
			switch {
			case e.IsDir && !Skip(e.Name) && SeasonOf(e.Name) == 0:
				dirs++
			case !e.IsDir && mediaExt.MatchString(e.Name):
				loose++
			}
		}
		if loose < 2 && dirs < 2 {
			plan.Reason = "no-match"
			return plan, nil
		}
		shelf, plan.Shelf = true, true
		subject = &Poster{Kind: "movie"}
	}
	// The plain title and year of the film or series, without a season's name.
	base := &Poster{Title: folder}
	if !shelf {
		if base, err = t.Details(ctx, subject.Kind, subject.ID); err != nil {
			return nil, err
		}
		plan.Subject = subject
	}
	title := SafeName(base.Title)

	multi := false   // a folder of several films keeps its own name
	seriesName := "" // ... or takes their series' name, when they are one series
	videos := []string{}
	for _, e := range entries {
		if !e.IsDir && mediaExt.MatchString(e.Name) && !IsJunk(e) { // a site's ad clip is no episode: it goes
			videos = append(videos, e.Name)
		}
	}
	sort.Strings(videos)
	newBase := map[string]string{}     // video name without extension -> new one
	into := map[string]string{}        // ... and the folder of its own it goes into (a folder of several films)
	episodeBase := map[[2]int]string{} // season and episode -> the new name of its video
	add := func(item RenameItem) {
		if item.New == item.Old && item.Into == "" {
			item.New = ""
			if item.Reason == "" {
				item.Reason = "same"
			}
		}
		plan.Items = append(plan.Items, item)
	}

	folderSeason, seasonYear := 0, 0
	if subject.Kind == "tv" {
		// Which season: chosen by hand, the folder's name ("第五季", "Season 2"),
		// the folder's own poster, then the folder above.
		switch {
		case season > 0:
			folderSeason = season
		case SeasonOf(folder) > 0:
			folderSeason = SeasonOf(folder)
		case ownSeason && subject.Season > 0:
			folderSeason = subject.Season
		case inherit != nil && inherit.Season > 0:
			folderSeason = inherit.Season
		}
		// A folder that is one season decides the season, even over "S01E05" in
		// a file name: names given under a wrong season must be fixable.
		anthology := false // set below: TMDB has one season, the release counts another
		seasonOf := func(s int) int {
			switch {
			case folderSeason > 0:
				return folderSeason
			case anthology && s > 1:
				return 1
			case s > 0:
				return s
			}
			return 1
		}
		// Episode counts turn absolute numbering (S2 starting at 29) into
		// numbering within the season.
		counts := map[int]int{}
		years := map[int]int{}
		last := 0
		if seasons, err := t.Seasons(ctx, subject.ID); err == nil {
			for _, s := range seasons {
				counts[s.Season] = s.Episodes
				years[s.Season] = s.Year
				if s.Season > last {
					last = s.Season
				}
			}
		}
		// A series TMDB has as one season that a release numbers as another: an
		// anthology's seasons as separate series ("Monster.2022.S02E01" is
		// 怪物：梅内德斯兄弟的故事, one season of 9 on TMDB). Its only season,
		// when the episode numbers fit inside it.
		if last == 1 && counts[1] > 0 {
			named, top := 0, 0
			for _, v := range videos {
				s, ep := ParseEpisode(v)
				if s > named {
					named = s
				}
				if ep > top {
					top = ep
				}
			}
			if top > 0 && top <= counts[1] && (folderSeason > 1 || named > 1) {
				anthology = true
				if folderSeason > 1 {
					folderSeason = 1
				}
			}
		}
		// Nothing names the season, the files do not either, and their numbers
		// fit inside the first season (so they are not counted on from it): with
		// several seasons this could be any of them. Wait for the person.
		if folderSeason == 0 && seasonsWithEpisodes(counts) > 1 {
			named, top := false, 0
			for _, v := range videos {
				s, ep := ParseEpisode(v)
				if s > 0 {
					named = true
				}
				if ep > top {
					top = ep
				}
			}
			if !named && top > 0 && top <= counts[1] {
				plan.Need = "season"
				for _, v := range videos {
					plan.Items = append(plan.Items, RenameItem{Old: v, Kind: "video", Reason: "pick-season"})
				}
				return plan, nil
			}
		}
		seasonYear = years[folderSeason]
		titles := map[int]map[int]string{}
		size := map[string]int64{}
		for _, e := range entries {
			size[e.Name] = e.Size
		}
		type episodeFile struct {
			old     string
			s, ep   int
			name    string
			version string
		}
		var found []*episodeFile
		byEpisode := map[[2]int][]*episodeFile{}
		for _, v := range videos {
			s, ep := ParseEpisode(v)
			if ep == 0 {
				add(RenameItem{Old: v, Kind: "video", Reason: "no-episode"})
				continue
			}
			s, ep = placeEpisode(counts, last, seasonOf(s), ep, s > 0)
			if titles[s] == nil {
				titles[s] = t.episodeTitles(ctx, subject.ID, s)
			}
			name := fmt.Sprintf("%s - S%02dE%02d", title, s, ep)
			if et := SafeName(titles[s][ep]); et != "" && !placeholderTitle.MatchString(et) {
				name += " - " + et
			}
			f := &episodeFile{old: v, s: s, ep: ep, name: name}
			found = append(found, f)
			byEpisode[[2]int{s, ep}] = append(byEpisode[[2]int{s, ep}], f)
		}
		// One episode in several files (a 14 GB remux beside a 2 GB encode):
		// the largest takes the plain name, the others a version tag, and the
		// person confirms each (they come unticked).
		for _, group := range byEpisode {
			if len(group) < 2 {
				continue
			}
			sort.SliceStable(group, func(i, j int) bool { return size[group[i].old] > size[group[j].old] })
			names := make([]string, len(group))
			for i, f := range group {
				names[i] = f.old
			}
			for i, f := range group {
				f.version = "main"
				if i > 0 {
					f.version = versionTag(names, i)
					f.name += " - " + f.version
				}
			}
		}
		// A series' own folder holding seasons' folders beside loose episodes (a
		// season of a one-season series came, then another): the loose ones go
		// into their season's folder, so each season is one folder.
		seasonDirs := map[int]string{}
		for _, e := range entries {
			if e.IsDir && !Skip(e.Name) {
				if s := SeasonOf(e.Name); s > 0 && seasonDirs[s] == "" {
					seasonDirs[s] = e.Name
				}
			}
		}
		gather := folderSeason == 0 && len(seasonDirs) > 0 && last > 1
		for _, f := range found {
			stem := strings.TrimSuffix(f.old, stdpath.Ext(f.old))
			newBase[stem] = f.name
			if f.version == "" || f.version == "main" {
				episodeBase[[2]int{f.s, f.ep}] = f.name
			}
			item := RenameItem{Old: f.old, New: f.name + extOf(f.old), Kind: "video", Season: f.s, Episode: f.ep}
			if gather && f.s > 0 {
				// By the name its season's folder takes (整理 renames that folder first, deepest first).
				item.Into = titleYear(title+" 第"+cnNumeral(f.s)+"季", firstYear(years[f.s], base.Year))
				into[stem] = item.Into
			}
			if f.version != "" {
				item.Reason, item.Size = "version", size[f.old]
			}
			add(item)
		}
	} else {
		whole := titleYear(title, base.Year)
		films := map[int]bool{}
		filmTitles := map[int]string{}
		size := map[string]int64{}
		for _, e := range entries {
			size[e.Name] = e.Size
		}
		type placed struct {
			video, name, part, title string
			id                       int
		}
		var list []placed
		var unmatched []string
		for i, v := range videos {
			if len(videos) == 1 && !shelf {
				list = append(list, placed{video: v, name: whole, title: title, id: subject.ID})
				continue
			}
			// Several films in one folder ("大话西游之大圣娶亲 - CD1.iso" next to
			// "唐伯虎点秋香.iso"): each video by its own name, parts by theirs without the part.
			stem := mediaExt.ReplaceAllString(v, "")
			part, look := "", v
			if m := partTag.FindStringSubmatchIndex(stem); m != nil {
				part = " - CD" + stem[m[2]:m[3]]
				look = strings.TrimSpace(strings.Trim(stem[:m[0]]+" "+stem[m[1]:], " -_."))
			}
			var own *Poster
			if i < 80 && !Skip(v) {
				if fp, err := t.resolve(ctx, look, dir); err == nil && !fp.None && fp.Kind == "movie" {
					own = fp
				}
			}
			if own == nil && part != "" && !shelf {
				own = subject // the folder's film in parts
			}
			if own == nil {
				unmatched = append(unmatched, v)
				continue
			}
			p := placed{video: v, name: titleYear(SafeName(own.Title), own.Year), title: SafeName(own.Title), part: part, id: own.ID}
			if own == subject {
				p.name, p.title = whole, title
			}
			list = append(list, p)
		}
		// "魔戒再现2.iso" found nothing (it searches like a sequel) beside a
		// "魔戒再现1.iso" that did: its second disc.
		for _, v := range unmatched {
			stem := mediaExt.ReplaceAllString(v, "")
			found := false
			if strings.HasSuffix(stem, "2") {
				for _, p := range list {
					if mediaExt.ReplaceAllString(p.video, "") == stem[:len(stem)-1]+"1" && p.part == "" {
						list = append(list, placed{video: v, name: p.name, title: p.title, id: p.id})
						found = true
						break
					}
				}
			}
			if !found {
				add(RenameItem{Old: v, Kind: "video", Reason: "several"})
			}
		}
		for _, p := range list {
			films[p.id], filmTitles[p.id] = true, p.title
		}
		// Films in folders of their own beside the videos here, or only
		// folders here: a series' folder ("招魂/招魂3 (2021)/"), not one film's.
		dirs := 0
		for _, e := range entries {
			if e.IsDir && !Skip(e.Name) && SeasonOf(e.Name) == 0 {
				dirs++
			}
		}
		onlyDirs := len(videos) == 0 && dirs > 1
		if dirs > 0 && (len(videos) > 0 || onlyDirs) && !shelf {
			asked := 0
			for _, e := range entries {
				if !e.IsDir || Skip(e.Name) || SeasonOf(e.Name) > 0 || asked >= 12 {
					continue
				}
				asked++
				fp, err := t.resolve(ctx, e.Name, dir)
				if err != nil || fp.None || fp.Kind != "movie" {
					continue
				}
				if !onlyDirs && fp.ID != subject.ID && !t.sameCollection(ctx, subject.ID, fp.ID) {
					continue // "花絮", a film's extras: no film of the series
				}
				films[fp.ID] = true
				filmTitles[fp.ID] = SafeName(fp.Title)
			}
		}
		multi = len(films) > 1 || onlyDirs || shelf
		if multi {
			seriesName, plan.SeriesFirst = t.seriesOf(ctx, filmTitles)
		}
		// One film in several files that are no parts (a 3D and a 4K disc): the
		// largest takes the plain name, the others a version, for the person to confirm.
		byFilm := map[string][]int{}
		for i, p := range list {
			key := fmt.Sprint(p.id, p.part)
			byFilm[key] = append(byFilm[key], i)
		}
		version := make([]string, len(list))
		for _, group := range byFilm {
			if len(group) < 2 {
				continue
			}
			// "魔戒再现1.iso", "魔戒再现2.iso": the two discs of one film, parts.
			if len(group) == 2 && list[group[0]].part == "" {
				a, b := mediaExt.ReplaceAllString(list[group[0]].video, ""), mediaExt.ReplaceAllString(list[group[1]].video, "")
				if a > b {
					a, b = b, a
					group[0], group[1] = group[1], group[0]
				}
				if len(a) == len(b) && strings.HasSuffix(a, "1") && strings.HasSuffix(b, "2") && a[:len(a)-1] == b[:len(b)-1] &&
					!sequelTitle(a[:len(a)-1], list[group[0]].title) {
					list[group[0]].part, list[group[1]].part = " - CD1", " - CD2"
					continue
				}
			}
			sort.SliceStable(group, func(a, b int) bool { return size[list[group[a]].video] > size[list[group[b]].video] })
			names := make([]string, len(group))
			for i, at := range group {
				names[i] = list[at].video
			}
			for i, at := range group {
				version[at] = "main"
				if i > 0 {
					version[at] = versionTag(names, i)
				}
			}
		}
		for i, p := range list {
			name := p.name + p.part
			if version[i] != "" && version[i] != "main" {
				name += " - " + version[i]
			}
			item := RenameItem{Old: p.video, New: name + extOf(p.video), Kind: "video"}
			if multi {
				item.Into = p.name // each film of a folder of several in a folder of its own
			}
			if version[i] != "" {
				item.Reason, item.Size = "version", size[p.video]
			}
			stem := strings.TrimSuffix(p.video, stdpath.Ext(p.video))
			newBase[stem], into[stem] = name, item.Into
			add(item)
		}
	}

	// Subtitles and .nfo files follow the video they are named after, keeping
	// what follows its name (".chs.ass", ".zh-CN.srt").
	for _, e := range entries {
		image := companionImage.MatchString(e.Name)
		if e.IsDir || !subtitleExt.MatchString(e.Name) && !image {
			continue
		}
		kind := "subtitle"
		if image || strings.HasSuffix(strings.ToLower(e.Name), ".nfo") {
			kind = "extra"
		}
		best := ""
		for old := range newBase {
			if (strings.HasPrefix(e.Name, old+".") || image && strings.HasPrefix(e.Name, old+"-")) && len(old) > len(best) {
				best = old
			}
		}
		if best != "" {
			add(RenameItem{Old: e.Name, New: newBase[best] + e.Name[len(best):], Kind: kind, Into: into[best]})
			continue
		}
		if kind == "extra" {
			continue // artwork and .nfo of no video here ("season.nfo", "tvshow.nfo") stay as they are
		}
		// Named after no video here (a "Subs" folder, "S05E03.chs.ass" next to
		// differently named videos): by its own episode number, else after the
		// folder's title, keeping its language tag.
		tail := subtitleTail(e.Name)
		stem := strings.TrimSuffix(e.Name, tail)
		var name string
		if subject.Kind == "tv" {
			s, ep := ParseEpisode(stem)
			if ep > 0 {
				s, ep = placeEpisodeIn(subject, folderSeason, s, ep, ctx, t)
				if name = episodeBase[[2]int{s, ep}]; name == "" {
					// Same name as its video gets in the folder beside it.
					name = fmt.Sprintf("%s - S%02dE%02d", title, s, ep)
					if et := SafeName(t.episodeTitles(ctx, subject.ID, s)[ep]); et != "" {
						name += " - " + et
					}
				}
			} else if folderSeason > 0 {
				name = title + " 第" + cnNumeral(folderSeason) + "季"
			} else {
				name = title
			}
		} else if len(videos) <= 1 && !multi {
			name = titleYear(title, base.Year)
			for _, v := range newBase {
				name = v
			}
		}
		if name == "" {
			continue
		}
		add(RenameItem{Old: e.Name, New: name + tail, Kind: kind})
	}

	// Ads and leftovers go; a lone folder wrapped around the film opens up
	// ("片名 (年份)/片名.6v电影 地址发布页…/片名.mp4").
	var kept []RenameEntry
	for _, e := range entries {
		if IsJunk(e) {
			plan.Items = append(plan.Items, RenameItem{Old: e.Name, Kind: "junk", Action: "delete", Size: e.Size})
			continue
		}
		kept = append(kept, e)
	}
	// A download lands as its release's folder ("片名 (年份)/【某某发布】片名[全8集].2160p…/"):
	// a film's, a series' or a show's folder holding only that opens up, so the
	// videos sit in the title's own folder. A season's folder ("第二季",
	// "Season 2") is no wrapping: a series keeps its seasons apart.
	// A series of one season keeps no season's folder either: its episodes sit in
	// the series' folder ("Monsters：… (2024)/… 第二季 (2024)/" opens up).
	oneSeason := subject.Kind == "tv" && folderSeason == 0 && t.regularSeasons(ctx, subject.ID) == 1
	// ... and when its episodes came twice (loose here, then as a season's folder), the folder merges up.
	if oneSeason && len(kept) > 1 {
		var dirs []RenameEntry
		for _, e := range kept {
			if e.IsDir && !Skip(e.Name) {
				dirs = append(dirs, e)
			}
		}
		if len(dirs) == 1 && SeasonOf(dirs[0].Name) > 0 {
			kept = dirs
		}
	}
	// A season's folder holding nothing but a folder of that same season ("第一季/第一季/"): one too many.
	sameSeason := subject.Kind == "tv" && folderSeason > 0 && len(kept) == 1 && kept[0].IsDir && SeasonOf(kept[0].Name) == folderSeason
	if (subject.Kind == "movie" && !multi || subject.Kind == "tv") && len(kept) == 1 && kept[0].IsDir && !Skip(kept[0].Name) &&
		(SeasonOf(kept[0].Name) == 0 || oneSeason || sameSeason) {
		inner, err := t.resolve(ctx, kept[0].Name, dir)
		// Not when it is clearly another title's folder ("招魂/招魂3 (2021)/"): its
		// name has that title. A guess its name hardly says ("q伏2.2013…" found
		// 潜伏) is no reason to keep the wrapping.
		var other bool
		if subject.Kind == "movie" {
			other = !inner.None && (inner.Kind != "movie" || inner.ID != subject.ID && !sequelOf(base, inner, kept[0].Name) &&
				strings.Contains(normalizeTitle(kept[0].Name), normalizeTitle(inner.Title)))
		} else {
			other = !inner.None && inner.ID != subject.ID && strings.Contains(normalizeTitle(kept[0].Name), normalizeTitle(inner.Title))
		}
		if err == nil && !other {
			plan.Items = append(plan.Items, RenameItem{Old: kept[0].Name, Kind: "unwrap", Action: "unwrap"})
		}
	}

	// The folder: "片名 (年份)", or "剧名 第二季 (年份)" for one season.
	folderName := titleYear(title, base.Year)
	if subject.Kind == "tv" && folderSeason > 0 {
		year := base.Year
		if seasonYear > 0 {
			year = seasonYear
		}
		folderName = titleYear(title+" 第"+cnNumeral(folderSeason)+"季", year)
		// A season's folder lying in the library itself: a tree, 影视库/剧名/剧名 第二季.
		// Into the series' folder (made when missing); a series of one season is
		// just the series' folder.
		if t.isRoot(stdpath.Dir(dir)) && !plan.Inherited {
			// The series' folder already there (by its TMDB id, whatever its name), else one by its title.
			box := t.SeriesFolderIn(stdpath.Dir(dir), subject.ID)
			switch {
			case box != "" && box != folder:
				folderName = box + "/" + folderName
			case t.regularSeasons(ctx, subject.ID) > 1:
				folderName = titleYear(title, base.Year) + "/" + folderName
			default:
				folderName = titleYear(title, base.Year)
			}
		}
	}
	if multi && seriesName != "" && !plan.Inherited {
		add(RenameItem{Old: folder, New: seriesName, Kind: "folder"})
	} else if multi {
		add(RenameItem{Old: folder, Kind: "folder", Reason: "several"})
		if shelf && seriesName == "" {
			// A box of several series ("漫威电影系列原盘ISO合集"): it can open up into
			// the folder above, each series and film beside the others. Not ticked by default.
			for _, e := range entries {
				if e.IsDir || mediaExt.MatchString(e.Name) {
					plan.Items = append(plan.Items, RenameItem{Old: folder, Kind: "spill", Action: "spill", Reason: "spill"})
					break
				}
			}
		}
	} else if plan.Inherited && SeasonOf(folder) == 0 && season == 0 {
		// "Subs", "Featurettes": a part of the folder above keeps its name
		// (a season picked by hand says what it is, and it is named for it).
		add(RenameItem{Old: folder, Kind: "folder", Reason: "inner"})
	} else {
		add(RenameItem{Old: folder, New: folderName, Kind: "folder"})
	}

	plan.Season = folderSeason
	plan.Film = subject.Kind == "movie" && !multi
	markConflicts(plan, entries)
	freeingFirst(plan)
	return plan, nil
}

// sequelOf reports whether name, matched to found, is really film: film's
// title goes further than found's ("潜伏3" past "潜伏") and name has all of it.
func sequelOf(film, found *Poster, name string) bool {
	a, own := normalizeTitle(film.Title), normalizeTitle(found.Title)
	return len(a) > len(own) && strings.HasPrefix(a, own) && strings.Contains(normalizeTitle(name), a)
}

// sameCollection reports whether two films are of one TMDB series.
func (t *TMDB) sameCollection(ctx context.Context, a, b int) bool {
	da, err := t.cachedDetails(ctx, "movie", a)
	if err != nil || da.Collection == 0 {
		return false
	}
	db, err := t.cachedDetails(ctx, "movie", b)
	return err == nil && db.Collection == da.Collection
}

// seriesOf names a folder of these films when they are all of one TMDB series
// ("" when they are not, or when TMDB has no series for them).
// first is the series' earliest film here, what the folder's own cover shows.
func (t *TMDB) seriesOf(ctx context.Context, films map[int]string) (name string, first int) {
	collection, firstYear := 0, 0
	titles := make([]string, 0, len(films))
	for id, title := range films {
		d, err := t.cachedDetails(ctx, "movie", id)
		if err != nil || d.Collection == 0 || collection != 0 && d.Collection != collection {
			return "", 0
		}
		collection, name = d.Collection, d.CollectionName
		if first == 0 || d.Year > 0 && (firstYear == 0 || d.Year < firstYear) {
			first, firstYear = id, d.Year
		}
		titles = append(titles, title)
	}
	if len(titles) < 2 {
		return "", 0
	}
	sort.Strings(titles)
	return seriesFolder(titles, name), first
}

// RenameWorthy reports whether a file is one the planner names (a video, a subtitle or .nfo).
func RenameWorthy(name string) bool {
	return mediaExt.MatchString(name) || subtitleExt.MatchString(name)
}

// versionTag tells apart the versions of one episode: by resolution when the
// names say different ones ("2160p"), else by number ("版本2").
func versionTag(names []string, i int) string {
	seen := map[string]bool{}
	byResolution := true
	for _, name := range names {
		r := strings.ToLower(resolutionTag.FindString(name))
		if r == "" || seen[r] {
			byResolution = false
			break
		}
		seen[r] = true
	}
	if byResolution {
		return strings.ToLower(resolutionTag.FindString(names[i]))
	}
	// Discs of one film in a box: say what each is ("3D", "4K") when the names tell them apart.
	if tags := discTags(names); tags != nil {
		return tags[i]
	}
	return "版本" + strconv.Itoa(i+1)
}

var discTag = regexp.MustCompile(`(?i)3d|4k|2160p|imax`)

// discTags names each version by its disc ("3D", "4K", "标准" for one that says
// nothing), or nil when two names would get the same.
func discTags(names []string) []string {
	out := make([]string, len(names))
	seen := map[string]bool{}
	for i, name := range names {
		tag := strings.ToUpper(discTag.FindString(mediaExt.ReplaceAllString(name, "")))
		if tag == "2160P" {
			tag = "4K"
		}
		if tag == "" {
			tag = "标准"
		}
		if seen[tag] {
			return nil
		}
		seen[tag], out[i] = true, tag
	}
	return out
}

// seasonsWithEpisodes counts a series' real seasons (specials, season 0, aside).
func seasonsWithEpisodes(counts map[int]int) int {
	n := 0
	for s, eps := range counts {
		if s > 0 && eps > 0 {
			n++
		}
	}
	return n
}

// placeEpisodeIn places a subtitle's episode like the videos of the folder.
func placeEpisodeIn(subject *Poster, folderSeason, s, ep int, ctx context.Context, t *TMDB) (int, int) {
	explicit := s > 0
	if folderSeason > 0 {
		s = folderSeason
	} else if s == 0 {
		s = 1
	}
	counts, last := map[int]int{}, 0
	if seasons, err := t.Seasons(ctx, subject.ID); err == nil {
		for _, info := range seasons {
			counts[info.Season] = info.Episodes
			if info.Season > last {
				last = info.Season
			}
		}
	}
	return placeEpisode(counts, last, s, ep, explicit)
}

// subtitleTail is what a subtitle keeps after its new name: a short language
// tag and the extension (".chs.ass", ".zh-CN.srt", ".简体.ass", ".srt").
func subtitleTail(name string) string {
	ext := stdpath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if dot := strings.LastIndex(stem, "."); dot >= 0 && langTag.MatchString(stem[dot+1:]) {
		return stem[dot:] + ext
	}
	if langTag.MatchString(stem) { // "简体中文.srt", "eng.srt"
		return "." + stem + ext
	}
	return ext
}

// freeingFirst orders the rows so a file moving out of a name goes before the
// file moving into it (the larger version taking the name a smaller one has).
func freeingFirst(plan *RenamePlan) {
	wanted := map[string]bool{}
	for _, item := range plan.Items {
		if item.New != "" && item.Kind != "folder" {
			wanted[strings.ToLower(item.New)] = true
		}
	}
	sort.SliceStable(plan.Items, func(i, j int) bool {
		return wanted[strings.ToLower(plan.Items[i].Old)] && !wanted[strings.ToLower(plan.Items[j].Old)]
	})
}

// placeEpisode fits an episode number to TMDB's seasons. Fansubs often number
// on from earlier seasons (S2 starting at 29), and TMDB sometimes files a new
// "season" under the old one (Frieren's second cour is S01E29-38), so a number
// that does not fit the named season is read as counted from the first one.
func placeEpisode(counts map[int]int, last, season, ep int, explicit bool) (int, int) {
	// A name that says its season and episode ("Friends.S04E24") means them,
	// even past the season's count on TMDB (which merges some two-part
	// episodes): only bare numbers are read as counted from the first season.
	if explicit {
		return season, ep
	}
	if n, ok := counts[season]; ok && (n == 0 || ep <= n) {
		return season, ep
	}
	if len(counts) == 0 {
		return season, ep
	}
	before := 0
	for s := 1; s <= last; s++ {
		n := counts[s]
		if ep <= before+n {
			return s, ep - before
		}
		before += n
	}
	return season, ep
}

// markConflicts drops proposals that would collide with each other or with a
// file that stays as it is.
func markConflicts(plan *RenamePlan, entries []RenameEntry) {
	moving := map[string]bool{}
	for _, item := range plan.Items {
		if item.New != "" && item.Kind != "folder" {
			moving[strings.ToLower(item.Old)] = true
		}
	}
	taken := map[string]int{}
	for _, e := range entries {
		if !moving[strings.ToLower(e.Name)] {
			taken[strings.ToLower(e.Name)]++
		}
	}
	for _, item := range plan.Items {
		if item.New != "" && item.Kind != "folder" {
			taken[strings.ToLower(item.New)]++
		}
	}
	for i, item := range plan.Items {
		if item.New != "" && item.Kind != "folder" && taken[strings.ToLower(item.New)] > 1 {
			plan.Items[i].New = ""
			plan.Items[i].Reason = "conflict"
		}
	}
}

// RenamedAs records what a folder renamed after a plan is: the plan's film or
// series (one season's poster for a season folder), so the new name never waits
// for a lookup, nor keeps a "nothing found" from its old, messy name. A poster
// chosen by hand for the same title stays as chosen.
func (t *TMDB) RenamedAs(ctx context.Context, dir, oldName, newName, newDir string, as RenameInherit) {
	t.mu.Lock()
	old := t.entries[Key(oldName)]
	t.mu.Unlock()
	if old != nil && old.Manual && !old.None && old.Kind == as.Kind && old.ID == as.ID {
		t.Renamed(dir, oldName, newName, newDir)
		return
	}
	p, err := t.Details(ctx, as.Kind, as.ID)
	if err != nil || p == nil || p.None {
		t.Renamed(dir, oldName, newName, newDir)
		return
	}
	if as.Kind == "tv" && as.Season > 0 {
		t.ApplySeason(ctx, p, as.Season)
	}
	p.Name, p.Dir, p.At = newName, newDir, time.Now().Unix()
	t.mu.Lock()
	delete(t.entries, Key(oldName))
	t.entries[Key(newName)] = p
	t.mu.Unlock()
	t.save()
}

// Renamed carries a poster entry to an object's new name, so a renamed folder or
// video keeps its poster (and a choice made by hand) without a new lookup.
func (t *TMDB) Renamed(dir, oldName, newName, newDir string) {
	t.mu.Lock()
	entry, ok := t.entries[Key(oldName)]
	if ok && entry.None && !entry.Manual {
		// "Nothing found" was about the old name; the new one gets its own look.
		delete(t.entries, Key(oldName))
	} else if ok && entry.Dir == dir {
		moved := *entry
		moved.Name = newName
		moved.Dir = newDir
		delete(t.entries, Key(oldName))
		t.entries[Key(newName)] = &moved
	}
	t.mu.Unlock()
	if ok {
		t.save()
	}
}

// PlanFiles proposes names for chosen files of a folder, each by its own match:
// a folder of different films ("电影/阿凡达.mkv, 盗梦空间.mkv") names every film
// after itself. Episode files, which name no film, fall back to the folder's plan.
// The folder's own name is left alone.
func (t *TMDB) PlanFiles(ctx context.Context, dir string, entries []RenameEntry, only []string, season int) (*RenamePlan, error) {
	if !t.Enabled() {
		return nil, errors.New("TMDB is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	picked := map[string]bool{}
	for _, name := range only {
		picked[name] = true
	}
	plan := &RenamePlan{Items: []RenameItem{}}
	var folderPlan *RenamePlan
	fromFolder := func(v string) (RenameItem, error) {
		if folderPlan == nil {
			p, err := t.PlanRename(ctx, dir, entries, season)
			if err != nil {
				return RenameItem{}, err
			}
			folderPlan = p
		}
		for _, item := range folderPlan.Items {
			if item.Old == v && item.Kind == "video" {
				return item, nil
			}
		}
		return RenameItem{Old: v, Kind: "video", Reason: "unknown"}, nil
	}
	newBase := map[string]string{}
	asked := 0
	for _, e := range entries {
		if e.IsDir || !picked[e.Name] || !mediaExt.MatchString(e.Name) {
			continue
		}
		item := RenameItem{Old: e.Name, Kind: "video"}
		if !Skip(e.Name) && asked < 60 {
			asked++
			fp, err := t.resolve(ctx, e.Name, dir)
			if err != nil {
				return nil, err
			}
			if !fp.None && fp.Kind == "movie" {
				item.New = titleYear(SafeName(fp.Title), fp.Year) + extOf(e.Name)
			}
		}
		if item.New == "" {
			var err error
			if item, err = fromFolder(e.Name); err != nil {
				return nil, err
			}
		}
		if item.New == item.Old {
			item.New, item.Reason = "", "same"
		}
		if item.New != "" {
			newBase[strings.TrimSuffix(e.Name, stdpath.Ext(e.Name))] = strings.TrimSuffix(item.New, extOf(e.Name))
		}
		plan.Items = append(plan.Items, item)
	}
	for _, e := range entries {
		if e.IsDir || !subtitleExt.MatchString(e.Name) {
			continue
		}
		best := ""
		for old := range newBase {
			if strings.HasPrefix(e.Name, old+".") && len(old) > len(best) {
				best = old
			}
		}
		if best != "" {
			plan.Items = append(plan.Items, RenameItem{Old: e.Name, New: newBase[best] + e.Name[len(best):], Kind: "subtitle"})
		}
	}
	if folderPlan != nil {
		plan.Subject, plan.Season = folderPlan.Subject, folderPlan.Season
	}
	markConflicts(plan, entries)
	return plan, nil
}

// sweepFilm: a video this size or larger is a film's or an episode's, never an ad.
const sweepFilm = 100 << 20

// JunkToSweep picks what of a library folder goes when it is only looked at
// (no 整理 run): its ads and leftovers, but only beside a film or an episode
// (a video of 100 MB or more), so a folder of small files is never emptied by
// guesswork; or the whole folder, when it holds nothing but ads ("Torrent
// Downloaded From/", "6v电影APP 有他不迷路/").
func JunkToSweep(entries []RenameEntry) (names []string, whole bool) {
	film, others := false, 0
	for _, e := range entries {
		switch {
		case IsJunk(e):
			names = append(names, e.Name)
		default:
			others++
			if !e.IsDir && mediaExt.MatchString(e.Name) && e.Size >= sweepFilm {
				film = true
			}
		}
	}
	if len(names) == 0 {
		return nil, false
	}
	if others == 0 {
		return names, true
	}
	if !film {
		return nil, false
	}
	return names, false
}
