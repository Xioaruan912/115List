package tgvio

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Some series are split into seasons on TMDB only in an episode group of type
// "TV" ("Seasons"): 葬送的芙莉莲 is one season of 38 episodes there, its
// "Seasons" group has Season 1 (episodes 1–28) and Season 2 (29–38), as
// releases and people count them. When such a group has more seasons than the
// series itself, it is the series' seasons everywhere: 整理's names, the
// series page, stills, news. Kept with the other TMDB answers (memo).

type tvOrder struct {
	Applies  bool                    `json:"applies"`
	Seasons  []SeasonInfo            `json:"seasons,omitempty"`
	Episodes map[string][]tmdbEpisode `json:"episodes,omitempty"` // season -> its episodes, numbered 1..n
}

var orderMemo = newMemo[tvOrder]("order") // "id/language"

type tmdbEpisodeGroups struct {
	Results []struct {
		ID         string `json:"id"`
		Type       int    `json:"type"`
		Name       string `json:"name"`
		GroupCount int    `json:"group_count"`
	} `json:"results"`
}

type tmdbEpisodeGroup struct {
	Groups []struct {
		Name     string `json:"name"`
		Order    int    `json:"order"`
		Episodes []struct {
			tmdbEpisode
			Order int `json:"order"`
		} `json:"episodes"`
	} `json:"groups"`
}

var (
	groupSeason  = regexp.MustCompile(`(?i)season\s*(\d+)|第\s*(\d+)\s*季`)
	groupSpecial = regexp.MustCompile(`(?i)special|特别|特典|番外`)
)

const episodeGroupTV = 6

// order is the series' seasons by its "TV" episode group, when that group has
// more regular seasons than TMDB's own (regular: TMDB's count, specials aside).
func (t *TMDB) order(ctx context.Context, id int, own []SeasonInfo) tvOrder {
	regular := 0
	posters := map[int]string{}
	for _, s := range own {
		if s.Season > 0 {
			regular++
		}
		posters[s.Season] = s.Poster
	}
	key := strconv.Itoa(id) + "/" + t.Config().Language
	o, _ := orderMemo.fetch(ctx, key, func(ctx context.Context) (tvOrder, error) {
		var list tmdbEpisodeGroups
		if err := t.get(ctx, "tv/"+strconv.Itoa(id)+"/episode_groups", nil, &list); err != nil {
			return tvOrder{}, err
		}
		best, most := "", 0
		for _, g := range list.Results {
			if g.Type == episodeGroupTV && g.GroupCount > most {
				best, most = g.ID, g.GroupCount
			}
		}
		if best == "" {
			return tvOrder{}, nil
		}
		var group tmdbEpisodeGroup
		if err := t.get(ctx, "tv/episode_group/"+best, nil, &group); err != nil {
			return tvOrder{}, err
		}
		out := tvOrder{Episodes: map[string][]tmdbEpisode{}}
		for _, g := range group.Groups {
			season := g.Order
			if m := groupSeason.FindStringSubmatch(g.Name); m != nil {
				season, _ = strconv.Atoi(firstOf(m[1], m[2]))
			} else if groupSpecial.MatchString(g.Name) {
				season = 0
			}
			eps := g.Episodes
			sort.SliceStable(eps, func(i, j int) bool { return eps[i].Order < eps[j].Order })
			list := make([]tmdbEpisode, 0, len(eps))
			for i, e := range eps {
				ep := e.tmdbEpisode
				ep.EpisodeNumber = i + 1
				list = append(list, ep)
			}
			if len(list) == 0 {
				continue
			}
			info := SeasonInfo{Season: season, Name: strings.TrimSpace(g.Name), Episodes: len(list), Air: list[0].AirDate}
			if len(info.Air) >= 4 {
				info.Year, _ = strconv.Atoi(info.Air[:4])
			}
			out.Seasons = append(out.Seasons, info)
			out.Episodes[strconv.Itoa(season)] = list
		}
		return out, nil
	})
	groupRegular := 0
	for _, s := range o.Seasons {
		if s.Season > 0 {
			groupRegular++
		}
	}
	applies := groupRegular > regular
	if applies != o.Applies {
		o.Applies = applies
		orderMemo.put(key, o) // remembered with the answer, so episodes() knows without TMDB's own seasons
	}
	if !applies {
		return tvOrder{}
	}
	seasons := make([]SeasonInfo, len(o.Seasons))
	copy(seasons, o.Seasons)
	for i := range seasons {
		seasons[i].Poster = posters[seasons[i].Season] // TMDB's own season poster, when it has that season
		if seasons[i].Season > 0 {
			seasons[i].Name = "第 " + strconv.Itoa(seasons[i].Season) + " 季"
		}
	}
	sort.SliceStable(seasons, func(i, j int) bool {
		if (seasons[i].Season == 0) != (seasons[j].Season == 0) {
			return seasons[j].Season == 0
		}
		return seasons[i].Season < seasons[j].Season
	})
	o.Seasons = seasons
	return o
}

// orderedEpisodes: a season's episodes by the series' "TV" episode group, when
// that is how its seasons go (ok false otherwise: TMDB's own season).
func (t *TMDB) orderedEpisodes(ctx context.Context, id, season int) ([]tmdbEpisode, bool) {
	t.cachedSeasons(ctx, id) // works the order out, when it was not yet
	o, _, ok := orderMemo.get(strconv.Itoa(id) + "/" + t.Config().Language)
	if !ok || !o.Applies {
		return nil, false
	}
	return o.Episodes[strconv.Itoa(season)], true
}

// regularSeasons counts a series' seasons, specials aside (by its episode group's seasons, when those are its own).
func (t *TMDB) regularSeasons(ctx context.Context, id int) int {
	n := 0
	for _, s := range t.cachedSeasons(ctx, id) {
		if s.Season > 0 {
			n++
		}
	}
	return n
}
