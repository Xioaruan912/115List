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
	"sync"
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
}

// RenameItem is one proposed rename.
type RenameItem struct {
	Old     string `json:"old"`
	New     string `json:"new,omitempty"`
	Kind    string `json:"kind"` // "video", "subtitle", "folder"
	Season  int    `json:"season,omitempty"`
	Episode int    `json:"episode,omitempty"`
	Reason  string `json:"reason,omitempty"` // why there is no proposal
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
}

// RenameInherit is what the folder above a subfolder was planned as, for
// subfolders that name nothing themselves ("Subs", "Season 2", "第五季").
type RenameInherit struct {
	Kind   string `json:"kind"`
	ID     int    `json:"id"`
	Season int    `json:"season,omitempty"`
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
	langTag   = regexp.MustCompile(`(?i)^(?:(?:en|eng|zh|chi|zho|chs|cht|sc|tc|gb|big5|ja|jp|jpn|ko|kor|fr|fre|de|ger|es|spa|ru|rus|it|pt|th|vi)(?:[-_](?:cn|tw|hk|hans|hant|sg|us|gb|br))?|forced|sdh|default|cc|(?:简|繁|中|英|日|韩|双语|体|文|字幕|[&+\-_])+)$`)
	partTag   = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])(?:cd|disc|disk|part|pt)[ ._-]?(\d{1,2})(?:[^0-9]|$)`)
	notEp     = regexp.MustCompile(`(?i)\b\d{3,4}p\b|[xh]\.?26[45]|\b(?:19|20)\d{2}\b|\b\d+bit\b|\bddp?\d\.\d\b|\b[257]\.1\b`)
)

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
	EpisodeNumber int    `json:"episode_number"`
	Name          string `json:"name"`
	StillPath     string `json:"still_path"`
}

var genericEpisode = regexp.MustCompile(`(?i)^(第\s*\d+\s*[集话話]|episode\s*\d+|エピソード\s*\d+|\d+)$`)

type seasonEpisodes struct {
	at     time.Time
	titles map[int]string
	stills map[int]string
}

// seasonCache keeps one season's episode names and stills for half a day:
// thumbnails ask for them on every folder visit.
var seasonCache sync.Map // "id/season/language" -> *seasonEpisodes

func (t *TMDB) episodes(ctx context.Context, id, season int) *seasonEpisodes {
	key := fmt.Sprintf("%d/%d/%s", id, season, t.Config().Language)
	if v, ok := seasonCache.Load(key); ok && time.Since(v.(*seasonEpisodes).at) < 12*time.Hour {
		return v.(*seasonEpisodes)
	}
	var s struct {
		Episodes []tmdbEpisode `json:"episodes"`
	}
	out := &seasonEpisodes{at: time.Now(), titles: map[int]string{}, stills: map[int]string{}}
	if err := t.get(ctx, "tv/"+strconv.Itoa(id)+"/season/"+strconv.Itoa(season), url.Values{}, &s); err != nil {
		return out // not cached: asked again next time
	}
	for _, e := range s.Episodes {
		if name := strings.TrimSpace(e.Name); name != "" && !genericEpisode.MatchString(name) {
			out.titles[e.EpisodeNumber] = name
		}
		if e.StillPath != "" {
			out.stills[e.EpisodeNumber] = e.StillPath
		}
	}
	seasonCache.Store(key, out)
	return out
}

// episodeTitles reads the episode names of one season (missing or placeholder
// names are left out).
func (t *TMDB) episodeTitles(ctx context.Context, id, season int) map[int]string {
	return t.episodes(ctx, id, season).titles
}

var seasonsCache sync.Map // id -> seasonsEntry

type seasonsEntry struct {
	at   time.Time
	list []SeasonInfo
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
	var seasons []SeasonInfo
	if v, ok := seasonsCache.Load(entry.ID); ok && time.Since(v.(seasonsEntry).at) < 12*time.Hour {
		seasons = v.(seasonsEntry).list
	} else if list, err := t.Seasons(ctx, entry.ID); err == nil {
		seasons = list
		seasonsCache.Store(entry.ID, seasonsEntry{at: time.Now(), list: list})
	}
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
	if entry != nil && (!entry.None || entry.Manual) {
		return entry, nil
	}
	p, err := t.lookup(ctx, name)
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
	ownSeason := true
	if inherit != nil && inherit.ID > 0 && (subject.None || subject.ID != inherit.ID || subject.Kind != inherit.Kind) &&
		(subject.None || inherit.Kind == "tv") {
		above, err := t.Details(ctx, inherit.Kind, inherit.ID)
		if err != nil {
			return nil, err
		}
		subject, ownSeason, plan.Inherited = above, false, true
	}
	if subject.None {
		plan.Reason = "no-match"
		return plan, nil
	}
	// The plain title and year of the film or series, without a season's name.
	base, err := t.Details(ctx, subject.Kind, subject.ID)
	if err != nil {
		return nil, err
	}
	plan.Subject = subject
	title := SafeName(base.Title)
	folder := pathBase(dir)

	multi := false // a folder of several films keeps its own name
	videos := []string{}
	for _, e := range entries {
		if !e.IsDir && mediaExt.MatchString(e.Name) {
			videos = append(videos, e.Name)
		}
	}
	sort.Strings(videos)
	newBase := map[string]string{}     // video name without extension -> new one
	episodeBase := map[[2]int]string{} // season and episode -> the new name of its video
	add := func(item RenameItem) {
		if item.New == item.Old {
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
		seasonOf := func(s int) int {
			switch {
			case folderSeason > 0:
				return folderSeason
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
			if et := SafeName(titles[s][ep]); et != "" {
				name += " - " + et
			}
			newBase[strings.TrimSuffix(v, stdpath.Ext(v))] = name
			episodeBase[[2]int{s, ep}] = name
			add(RenameItem{Old: v, New: name + extOf(v), Kind: "video", Season: s, Episode: ep})
		}
	} else {
		whole := titleYear(title, base.Year)
		films := map[int]bool{}
		for i, v := range videos {
			name := whole
			if len(videos) > 1 {
				if m := partTag.FindStringSubmatch(mediaExt.ReplaceAllString(v, "")); m != nil {
					name += " - CD" + m[1]
					films[subject.ID] = true
				} else {
					// Several films in one folder ("大话西游之月光宝盒.iso" next to
					// "大话西游之大圣娶亲.iso"): each video by its own name.
					var own *Poster
					if i < 12 && !Skip(v) {
						if fp, err := t.resolve(ctx, v, dir); err == nil && !fp.None && fp.Kind == "movie" {
							own = fp
						}
					}
					if own == nil {
						add(RenameItem{Old: v, Kind: "video", Reason: "several"})
						continue
					}
					films[own.ID] = true
					name = titleYear(SafeName(own.Title), own.Year)
				}
			} else {
				films[subject.ID] = true
			}
			newBase[strings.TrimSuffix(v, stdpath.Ext(v))] = name
			add(RenameItem{Old: v, New: name + extOf(v), Kind: "video"})
		}
		multi = len(films) > 1
	}

	// Subtitles and .nfo files follow the video they are named after, keeping
	// what follows its name (".chs.ass", ".zh-CN.srt").
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
			add(RenameItem{Old: e.Name, New: newBase[best] + e.Name[len(best):], Kind: "subtitle"})
			continue
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
		add(RenameItem{Old: e.Name, New: name + tail, Kind: "subtitle"})
	}

	// The folder: "片名 (年份)", or "剧名 第二季 (年份)" for one season.
	folderName := titleYear(title, base.Year)
	if subject.Kind == "tv" && folderSeason > 0 {
		year := base.Year
		if seasonYear > 0 {
			year = seasonYear
		}
		folderName = titleYear(title+" 第"+cnNumeral(folderSeason)+"季", year)
	}
	if multi {
		add(RenameItem{Old: folder, Kind: "folder", Reason: "several"})
	} else if plan.Inherited && SeasonOf(folder) == 0 && season == 0 {
		// "Subs", "Featurettes": a part of the folder above keeps its name
		// (a season picked by hand says what it is, and it is named for it).
		add(RenameItem{Old: folder, Kind: "folder", Reason: "inner"})
	} else {
		add(RenameItem{Old: folder, New: folderName, Kind: "folder"})
	}

	plan.Season = folderSeason
	markConflicts(plan, entries)
	return plan, nil
}

// RenameWorthy reports whether a file is one the planner names (a video, a subtitle or .nfo).
func RenameWorthy(name string) bool {
	return mediaExt.MatchString(name) || subtitleExt.MatchString(name)
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

// Renamed carries a poster entry to an object's new name, so a renamed folder or
// video keeps its poster (and a choice made by hand) without a new lookup.
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
