# Runs the official OmniRoute image on Render (free plan, 512 MB RAM)
FROM diegosouzapw/omniroute:latest

# Low-memory tuning for 512 MB containers
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    OMNIROUTE_MEMORY_MB=256 \
    APP_LOG_TO_FILE=false \
    APP_LOG_LEVEL=warn \
    CALL_LOG_MAX_ENTRIES=200 \
    CALL_LOGS_TABLE_MAX_ROWS=2000 \
    CALL_LOG_RETENTION_DAYS=1 \
    CALL_LOG_PIPELINE_CAPTURE_STREAM_CHUNKS=false \
    STREAM_HISTORY_MAX=10 \
    OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT=1 \
    OMNIROUTE_CHAT_MAX_INFLIGHT_BYTES=16777216 \
    OMNIROUTE_PRESSURE_PSI_DISABLED=true \
    OMNIROUTE_PRESSURE_SELF_RESTART=true \
    OMNIROUTE_PRESSURE_SELF_RESTART_AFTER_MS=60000 \
    OMNIROUTE_ENABLE_LIVE_WS=0

# Startup script: auto-sets OMNIROUTE_PUBLIC_BASE_URL from your Render domain
COPY --chmod=755 render-start.sh /app/render-start.sh

EXPOSE 20128
ENTRYPOINT ["/app/render-start.sh"]
CMD ["node", "dev/run-standalone.mjs"]
