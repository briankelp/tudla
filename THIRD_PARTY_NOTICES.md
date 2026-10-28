# Third-party notices

Tudla's own code is distributed under [ISC](LICENSE). Dependencies and fonts retain their own licenses.

The production browser build generates `THIRD_PARTY_NOTICES.txt` from the license/notice files of the packages actually included in its JavaScript chunks. IBM Plex Sans is included under the [SIL Open Font License](apps/web/public/IBM-Plex-OFL.txt). Keep these files with redistributed browser builds.

The API, worker, database tooling, and development dependencies are installed from npm using `package-lock.json`. Their package directories contain their license and notice files; retain them when redistributing those packages or Docker images. The bundled Supabase PostgreSQL root certificate is public trust material; its provenance is documented in [packages/database/certs/README.md](packages/database/certs/README.md).
