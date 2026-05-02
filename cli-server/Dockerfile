# Multi-stage build: tiny final image with just the binary + CA certs.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/cli-server .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /out/cli-server /usr/local/bin/cli-server
EXPOSE 2222
EXPOSE 1965
ENTRYPOINT ["/usr/local/bin/cli-server"]
