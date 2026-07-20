-- SPDX-License-Identifier: GPL-3.0-or-later

evolution_core = rawget(_G, "evolution_core") or {}

local modpath = minetest.get_modpath(minetest.get_current_modname())
evolution_core.modpath = modpath
evolution_core.content = dofile(modpath .. "/content.generated.lua")

for _, file in ipairs({
    "state.lua",
    "identity.lua",
    "timelines.lua",
    "nodes.lua",
    "realms.lua",
    "gameplay.lua",
    "ui.lua",
    "commands.lua",
}) do
    dofile(modpath .. "/" .. file)
end

minetest.log("action", "[evolution_core] playable origin loop 0.4.0 loaded")
