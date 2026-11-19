# Upstream provenance

- Project: tailuge/billiards
- Repository: https://github.com/tailuge/billiards
- Commit: `8aeb1dee14e7dccf71b47cdf6f68fc33e5f6459b`
- Commit URL: https://github.com/tailuge/billiards/commit/8aeb1dee14e7dccf71b47cdf6f68fc33e5f6459b
- Retrieved: 2026-11-17 from the GitHub master archive; the commit was independently confirmed through the GitHub commits API.
- License: GNU General Public License v3.0, preserved at `third_party/billiards/LICENSE` and copied to the project root.

The upstream physics, rack, geometry, outcome and snooker utility algorithms are used by `packages/core`. The new headless match state machine, protocol, authoritative room server, procedural renderer and WeChat adapters are modifications/additions in this repository. This project is distributed under GPL-3.0-only. A real public corresponding-source URL must be configured before public distribution; see `docs/PUBLISHING.md`.

## Local modifications

- `src/model/physics/knuckle.ts`: use the standard restitution impulse `-(1 + e) * velDotCenters` for pocket-jaw collisions. The previous `-2 * e` factor retained only about 46% of normal incident speed at `e=0.73`; the corrected collision retains about 73%, consistent with the configured cushion response. Angular-velocity attenuation is unchanged.
- Corner pocket sizing is configured outside the upstream sources in `packages/core/src/tuning.ts`, which scales the shared physical and rendered corner radius to 85% after each table-geometry reset. Middle pockets are unchanged.
