# Public catalog edition

This repository runs the full Story Poster app and keeps its source search and guide-building adapters. Its built-in guide list is the original 14-guide catalog.

The hosted service currently has 20 additional preloaded library entries: five prepared guides, twelve home adaptations, and three saved general guides. Those entries and their copied source text are not included here. This edition therefore shows fewer preloaded topics than the hosted demo. The app can still search linked public sources and build new guides when configured with its normal account and service settings.

Run the reduced catalog with `npm run start:public`. The app, sample, hosted, and Docker start paths enable public-catalog mode. The kit, preview, and test runners that can load the catalog set the same flag. In this mode, a missing optional saved-guide bundle is treated as an empty catalog. Normal saved-library mode still fails closed when its saved-general bundle is missing.
