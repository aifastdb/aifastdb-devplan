package main

import helper "./helper"

type GoRunner struct{}

func (r *GoRunner) Run() string {
	return helper.HelperCall()
}

func BootstrapGo() string {
	runner := GoRunner{}
	return runner.Run()
}
