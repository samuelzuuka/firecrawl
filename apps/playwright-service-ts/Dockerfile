FROM node:18-slim

WORKDIR /usr/src/app
COPY package*.json .npmrc ./
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/tmp/.cache

RUN mv /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.sources.bak
COPY dockerenv/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt install apt-transport-https ca-certificates

# Install Playwright dependencies
RUN npx playwright install --with-deps

RUN npm run build

ARG PORT
ENV PORT=${PORT}

EXPOSE ${PORT}

CMD [ "npm", "start" ]
