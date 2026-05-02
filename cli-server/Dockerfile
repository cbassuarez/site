# Multi-stage build: tiny final image with just the binary + CA certs.
FROM golang:1.22-alpine AS build
WORKDIR /src

# Copy everything first so `go mod tidy` can scan imports. (We sacrifice some
# layer caching here, but the alternative — pre-caching deps with just go.mod
# — needs a committed go.sum, which we don't ship in tree on first deploy.)
COPY . .

# Resolve go.sum if missing or outdated; then build. CGO disabled for a fully
# static binary.
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/cli-server .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /out/cli-server /usr/local/bin/cli-server
EXPOSE 2222
EXPOSE 1965
ENTRYPOINT ["/usr/local/bin/cli-server"]
