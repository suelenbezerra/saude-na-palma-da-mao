FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Recife PORT=8080 HOST=0.0.0.0
COPY package.json ./
COPY backend ./backend
COPY dist ./dist
COPY server.cjs ./
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
