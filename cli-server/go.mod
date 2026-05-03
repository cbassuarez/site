module github.com/cbassuarez/site/cli-server

go 1.22

require (
	github.com/gliderlabs/ssh v0.3.7
	github.com/hajimehoshi/go-mp3 v0.3.4
)

// Indirect dependencies are resolved by `go mod tidy` on first build.
