-- SPDX-License-Identifier: GPL-3.0-or-later

local realms = {}
local storage = minetest.get_mod_storage()
local configured_y = tonumber(minetest.settings:get("evolution_origin_y")) or 20000
local ORIGIN_Y = math.max(1000, math.min(30000, math.floor(configured_y)))
local THREE_D_Y = math.min(30500, ORIGIN_Y + 100)
local mode = minetest.settings:get("evolution_mode") or "standalone"

local function set(pos, name)
    minetest.set_node(pos, {name = name})
end

local function clear_box(center, radius, height)
    for x = -radius, radius do
        for z = -radius, radius do
            for y = 1, height do
                set({x = center.x + x, y = center.y + y, z = center.z + z}, "air")
            end
        end
    end
end

function realms.build_origin()
    if storage:get_int("origin_layout_v1") == 1 then return end
    local center = {x = 0, y = ORIGIN_Y, z = 0}
    clear_box(center, 7, 5)
    for x = -6, 6 do
        for z = -6, 6 do
            set({x = x, y = ORIGIN_Y, z = z}, "evolution_core:void_anchor")
        end
    end
    set({x = 0, y = ORIGIN_Y + 1, z = 0}, "evolution_core:chaos_core")
    set({x = 3, y = ORIGIN_Y + 1, z = 0}, "evolution_core:fracture")
    set({x = -3, y = ORIGIN_Y + 1, z = 0}, "evolution_core:fusion_field")
    set({x = 0, y = ORIGIN_Y + 1, z = 3}, "evolution_core:dimension_gate")
    storage:set_int("origin_layout_v1", 1)
end

function realms.build_first_3d()
    if storage:get_int("first_3d_layout_v1") == 1 then return end
    local center = {x = 0, y = THREE_D_Y, z = 0}
    clear_box(center, 11, 6)
    for x = -10, 10 do
        for z = -10, 10 do
            local name = "evolution_core:primordial_matter"
            if math.abs(x) == 10 or math.abs(z) == 10 then name = "evolution_core:void_anchor" end
            set({x = x, y = THREE_D_Y, z = z}, name)
        end
    end
    set({x = -4, y = THREE_D_Y + 1, z = 0}, "evolution_core:creation_focus")
    set({x = 0, y = THREE_D_Y + 1, z = 0}, "evolution_core:stability_focus")
    set({x = 4, y = THREE_D_Y + 1, z = 0}, "evolution_core:destruction_focus")
    storage:set_int("first_3d_layout_v1", 1)
end

function realms.enter(player, phase)
    if phase == "first_3d" then
        realms.build_first_3d()
        player:set_pos({x = 0, y = THREE_D_Y + 2, z = 5})
    else
        realms.build_origin()
        player:set_pos({x = 0, y = ORIGIN_Y + 2, z = -4})
    end
end

function realms.mode()
    return mode
end

minetest.register_on_joinplayer(function(player)
    if mode ~= "standalone" then return end
    local name = player:get_player_name()
    minetest.after(0.5, function()
        local current = minetest.get_player_by_name(name)
        if current then realms.enter(current, evolution_core.api.get_state(current).phase) end
    end)
end)

evolution_core.realms = realms
