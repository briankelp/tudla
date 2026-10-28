# Supabase database certificate

`supabase-root-2021.crt` is Supabase's public root CA certificate, downloaded from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

The download URL is published in [Supabase Studio's configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json). The certificate contains no private key or application credentials. It expires on 26 April 2031.

SHA-256 fingerprint:

```text
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

Use `sslmode=verify-full` and an `sslrootcert` parameter pointing to this file on each Supabase PostgreSQL connection URL. Use an absolute path locally. The existing Dockerfile includes this directory at `/app/packages/database/certs/`, so the hosted path is `/app/packages/database/certs/supabase-root-2021.crt`.

See [Supabase's SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement). Check the published certificate and expiration before replacing it; do not work around certificate failures by disabling verification.
