# Runs the official OmniRoute image on Render
FROM diegosouzapw/omniroute:latest

# Render injects $PORT automatically; OmniRoute reads PORT.
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    OMNIROUTE_MEMORY_MB=320

EXPOSE 20128
