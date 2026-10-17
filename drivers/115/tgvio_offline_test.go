package _115

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOfflineHashes(t *testing.T) {
	parse := func(s string) offlineAddAnswer {
		var a offlineAddAnswer
		if err := json.Unmarshal([]byte(s), &a); err != nil {
			t.Fatal(err)
		}
		return a
	}
	if h, err := offlineHashes(parse(`{"state":true,"result":[{"state":true,"info_hash":"abc"}]}`), 1); err != nil || h[0] != "abc" {
		t.Fatalf("ok: %v %v", h, err)
	}
	if h, err := offlineHashes(parse(`{"state":true,"result":[{"state":false,"errcode":10008,"error_msg":"任务已存在","info_hash":"abc"}]}`), 1); err != nil || h[0] != "abc" {
		t.Fatalf("exists: %v %v", h, err)
	}
	_, err := offlineHashes(parse(`{"state":true,"result":[{"state":false,"errcode":10004,"error_msg":"链接无效","info_hash":""}]}`), 1)
	if err == nil || !strings.Contains(err.Error(), "链接无效") {
		t.Fatalf("refused: %v", err)
	}
	_, err = offlineHashes(parse(`{"state":false,"errcode":911,"error_msg":"请验证账号"}`), 1)
	if err == nil || !strings.Contains(err.Error(), "请验证账号") {
		t.Fatalf("whole request refused: %v", err)
	}
}
