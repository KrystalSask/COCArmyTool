# COCArmyTool 第三方声明

项目根目录的 PolyForm Noncommercial 许可只适用于版权所有者有权许可的 COCArmyTool 自有软件。下列第三方代码、元数据、图像、名称和商标不因收录在本仓库中而被重新许可，使用者必须同时遵守其上游许可和权利人的适用政策。

## clashy.py 静态游戏元数据

- Project: `ClashKingInc/clashy.py`
- Repository: https://github.com/ClashKingInc/clashy.py
- License: MIT
- Usage: The repository's static game metadata was used to build the reduced unit, spell, hero, pet and equipment ID table in `src/data/gameData.generated.json`.
- Modifications: Only fields needed by this application are retained; home-village trainable content is automatically filtered by housing space, production building and seasonal flags; Chinese display-name overrides are maintained separately.

The generated metadata is not presented as official Supercell documentation. Clash of Clans and Supercell trademarks and game content remain the property of their respective owners.

## Clash of Clans 图像素材

- Primary package: `chiefpansancolt/clash-of-clans-data` 0.16.0 (MIT package license; its README identifies Clash of Clans Wiki as the data source).
- Gap source: 部落冲突 BWIKI file pages for nine newer or separately stored icons.
- Usage: 136 runtime PNG icons are stored locally under `public/game-icons`; the application does not hotlink them. Newer gaps are supplemented from BWIKI/user-verified game screenshots.
- Audit: exact category counts and current exclusions are recorded in `docs/terminology-audit.md`; `scripts/audit-game-catalog.mjs` checks missing and surplus assets.

The depicted characters and other game artwork are Supercell assets and are not relicensed by the packages above. Their use is subject to Supercell's Fan Content Policy: https://supercell.com/en/fan-content-policy/. This project is unofficial and is not endorsed by Supercell.
