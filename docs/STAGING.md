# Staging Deployment

Use the `dev` branch for the staging app at:

```text
https://doth-dev.webtummy.com
```

Production remains on `app.webtummy.com`.

## First Setup

1. Point DNS for `doth-dev.webtummy.com` to the same server as production.
2. Copy the staging environment file:

```sh
cp .env.dev.example .env.dev
```

3. Set staging-only secrets in `.env.dev`.
4. Install the Nginx vhost:

```sh
sudo cp deploy/doth-dev.webtummy.com.conf /etc/nginx/sites-available/doth-dev.webtummy.com.conf
sudo ln -s /etc/nginx/sites-available/doth-dev.webtummy.com.conf /etc/nginx/sites-enabled/doth-dev.webtummy.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

5. Issue the TLS certificate:

```sh
sudo certbot --nginx -d doth-dev.webtummy.com
```

## Deploy Dev Branch

```sh
git checkout dev
git pull origin dev
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d --build
```

The staging compose project uses:

- Separate Compose project name: `webtummy-dev`
- Separate MySQL volume: `webtummy-dev_mysql_dev_data`
- Separate Redis volume: `webtummy-dev_redis_dev_data`
- Separate local web port: `127.0.0.1:8081`

Production continues to use `docker-compose.prod.yml` and `127.0.0.1:8080`.
