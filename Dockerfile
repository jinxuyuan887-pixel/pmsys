FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install

COPY . .

ARG NEXT_PUBLIC_BASE_PATH=/pmsys
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

RUN ./node_modules/.bin/vinext build

EXPOSE 3000

CMD ["npm", "run", "start"]
