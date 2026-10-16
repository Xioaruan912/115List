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
}

var genericEpisode = regexp.MustCompile(`(?i)^(第\s*\d+\s*[集话話]|episode\s*\d+|エピソード\s*\d+|\d+)$`)

// episodeTitles reads the episode names of one season (missing or placeholder
// names are left out).
func (t *TMDB) episodeTitles(ctx context.Context, id, season int) map[int]string {
	var s struct {
		Episodes []tmdbEpisode `json:"episodes"`
	}
	out := map[int]string{}
	if err := t.get(ctx, "tv/"+strconv.Itoa(id)+"/season/"+strconv.Itoa(season), url.Values{}, &s); err != nil {
		return out
	}
	for _, e := range s.Episodes {
		if name := strings.TrimSpace(e.Name); name != "" && !genericEpisode.MatchString(name) {
			out[e.EpisodeNumber] = name
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
	newBase := map[string]string{} // video name without extension -> new one
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
		folderSeason = subject.Season
		if season > 0 {
			folderSeason = season
		}
		if folderSeason == 0 {
			folderSeason = SeasonOf(folder)
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
		seasonYear = years[folderSeason]
		titles := map[int]map[int]string{}
		for _, v := range videos {
			s, ep := ParseEpisode(v)
			if ep == 0 {
				add(RenameItem{Old: v, Kind: "video", Reason: "no-episode"})
				continue
			}
			s, ep = placeEpisode(counts, last, seasonOf(s), ep)
			if titles[s] == nil {
				titles[s] = t.episodeTitles(ctx, subject.ID, s)
			}
			name := fmt.Sprintf("%s - S%02dE%02d", title, s, ep)
			if et := SafeName(titles[s][ep]); et != "" {
				name += " - " + et
			}
			newBase[strings.TrimSuffix(v, stdpath.Ext(v))] = name
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
		if best == "" {
			continue
		}
		add(RenameItem{Old: e.Name, New: newBase[best] + e.Name[len(best):], Kind: "subtitle"})
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
	} else {
		add(RenameItem{Old: folder, New: folderName, Kind: "folder"})
	}

	plan.Season = folderSeason
	markConflicts(plan, entries)
	return plan, nil
}

// placeEpisode fits an episode number to TMDB's seasons. Fansubs often number
// on from earlier seasons (S2 starting at 29), and TMDB sometimes files a new
// "season" under the old one (Frieren's second cour is S01E29-38), so a number
// that does not fit the named season is read as counted from the first one.
func placeEpisode(counts map[int]int, last, season, ep int) (int, int) {
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
func (t *TMDB) Renamed(dir, oldName, newName, newDir string) {
	t.mu.Lock()
	entry, ok := t.entries[Key(oldName)]
	if ok && entry.Dir == dir {
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
