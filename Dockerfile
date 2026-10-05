# Runs the official OmniRoute image on Render (free plan)
FROM diegosouzapw/omniroute:latest

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    OMNIROUTE_MEMORY_MB=320

# Startup script: auto-sets OMNIROUTE_PUBLIC_BASE_URL from your Render domain
COPY --chmod=755 render-start.sh /app/render-start.sh

EXPOSE 20128
ENTRYPOINT ["/app/render-start.sh"]
CMD ["node", "dev/run-standalone.mjs"]
