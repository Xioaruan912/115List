package task

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/pkg/errors"
)

func waitForTaskSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for task")
	}
}

func TestTask_Manager(t *testing.T) {
	var next atomic.Uint64
	started, finish := make(chan struct{}), make(chan struct{}, 1)
	defer close(finish)
	tm := NewTaskManager(1, func(id *uint64) {
		*id = next.Add(1)
	})
	id := tm.Submit(WithCancelCtx(&Task[uint64]{
		Name: "test",
		Func: func(task *Task[uint64]) error {
			close(started)
			<-finish
			return nil
		},
	}))
	task, ok := tm.Get(id)
	if !ok {
		t.Fatal("task not found")
	}
	waitForTaskSignal(t, started)
	if task.state != RUNNING {
		t.Errorf("task status not running: %s", task.state)
	}
	finish <- struct{}{}
	waitForTaskSignal(t, tm.workerC)
	if task.state != SUCCEEDED {
		t.Errorf("task status not finished: %s", task.state)
	}
}

func TestTask_Cancel(t *testing.T) {
	var next atomic.Uint64
	started := make(chan struct{})
	tm := NewTaskManager(1, func(id *uint64) {
		*id = next.Add(1)
	})
	id := tm.Submit(WithCancelCtx(&Task[uint64]{
		Name: "test",
		Func: func(task *Task[uint64]) error {
			close(started)
			<-task.Ctx.Done()
			return nil
		},
	}))
	task, ok := tm.Get(id)
	if !ok {
		t.Fatal("task not found")
	}
	t.Cleanup(task.Cancel)
	waitForTaskSignal(t, started)
	task.Cancel()
	waitForTaskSignal(t, tm.workerC)
	if task.state != CANCELED {
		t.Errorf("task status not canceled: %s", task.state)
	}
}

func TestTask_Retry(t *testing.T) {
	var next atomic.Uint64
	started := make(chan struct{})
	tm := NewTaskManager(1, func(id *uint64) {
		*id = next.Add(1)
	})
	num := 0
	id := tm.Submit(WithCancelCtx(&Task[uint64]{
		Name: "test",
		Func: func(task *Task[uint64]) error {
			num++
			if num&1 == 1 {
				close(started)
				return errors.New("test error")
			}
			return nil
		},
	}))
	task, ok := tm.Get(id)
	if !ok {
		t.Fatal("task not found")
	}
	waitForTaskSignal(t, started)
	waitForTaskSignal(t, tm.workerC)
	if task.Error == nil {
		t.Error(task.state)
		t.Fatal("task error is nil, but expected error")
	} else {
		t.Logf("task error: %s", task.Error)
	}
	task.retry()
	if task.Error != nil {
		t.Errorf("task error: %+v, but expected nil", task.Error)
	}
}
