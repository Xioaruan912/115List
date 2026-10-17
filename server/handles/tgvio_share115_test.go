package handles

import "testing"

func TestParseShareLink(t *testing.T) {
	cases := []struct{ in, code, pass string }{
		{"https://115.com/s/swh1abcd2ef?password=x9k2#", "swh1abcd2ef", "x9k2"},
		{"https://115cdn.com/s/sw3xyz?password=ab12&", "sw3xyz", "ab12"},
		{"链接：https://115.com/s/swq7rt 提取码：Q8W2 复制这段内容后打开115App", "swq7rt", "q8w2"},
		{"115.com/s/swabc#zz99", "swabc", "zz99"},
		{"https://115.com/s/swnopass", "swnopass", ""},
	}
	for _, c := range cases {
		code, pass, ok := parseShareLink(c.in)
		if !ok || code != c.code || pass != c.pass {
			t.Errorf("parseShareLink(%q) = %q %q %v, want %q %q", c.in, code, pass, ok, c.code, c.pass)
		}
	}
	if _, _, ok := parseShareLink("https://pan.baidu.com/s/1abc"); ok {
		t.Error("baidu link accepted")
	}
}
