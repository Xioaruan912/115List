package _115

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOfflineHash(t *testing.T) {
	parse := func(s string) offlineAdded {
		var a offlineAdded
		if err := json.Unmarshal([]byte(s), &a); err != nil {
			t.Fatal(err)
		}
		return a
	}
	if h, err := offlineHash(parse(`{"state":true,"errno":0,"errtype":"","errcode":0,"info_hash":"abc","url":"magnet:?xt=urn:btih:abc"}`)); err != nil || h != "abc" {
		t.Fatalf("ok: %v %v", h, err)
	}
	if h, err := offlineHash(parse(`{"state":false,"errcode":10008,"error_msg":"任务已存在","info_hash":"abc"}`)); err != nil || h != "abc" {
		t.Fatalf("exists: %v %v", h, err)
	}
	_, err := offlineHash(parse(`{"state":false,"errcode":10004,"error_msg":"链接无效","info_hash":""}`))
	if err == nil || !strings.Contains(err.Error(), "链接无效") {
		t.Fatalf("refused: %v", err)
	}
}
