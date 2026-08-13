FROM oven/bun:1-alpine
WORKDIR /app
COPY . /app/
ENV KBSERVE_PORT=3090
ENV EVOLVE_HOME=/data
VOLUME ["/data"]
EXPOSE 3090
CMD ["bun", "serve.ts"]