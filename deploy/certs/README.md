# TLS certificates (deployment)

Place the certificate chain and private key here before starting the HTTPS overlay:

```
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```

- Production: provision from your CA or a reverse proxy that terminates TLS in front of `web`.
- Staging/local verification only: generate a self-signed certificate, for example:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout deploy/certs/privkey.pem \
  -out deploy/certs/fullchain.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Certificates and keys are ignored by Git; never commit real private keys.
Run the overlay with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
and set `WEB_HTTPS_PORT` if 8443 is unavailable.
