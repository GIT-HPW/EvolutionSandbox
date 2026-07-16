-- SPDX-License-Identifier: GPL-3.0-or-later

local function tile(color)
    return "[fill:16x16:0,0:" .. color
end

local function perform(clicker, action)
    if not clicker or not clicker:is_player() then return end
    local ok, message = evolution_core.perform_action(clicker, action)
    minetest.chat_send_player(clicker:get_player_name(), message)
    return ok
end

local function action_node(name, description, color, action)
    minetest.register_node("evolution_core:" .. name, {
        description = description,
        tiles = {tile(color)},
        groups = {immortal = 1, not_in_creative_inventory = 1, evolution_sandbox = 1},
        light_source = 8,
        paramtype = "light",
        sunlight_propagates = true,
        on_rightclick = function(_pos, _node, clicker)
            perform(clicker, action)
        end,
        can_dig = function() return false end,
    })
end

minetest.register_node("evolution_core:void_anchor", {
    description = "Realm Anchor",
    tiles = {tile("#11162b")},
    groups = {immortal = 1, not_in_creative_inventory = 1, evolution_sandbox = 1},
    can_dig = function() return false end,
})

minetest.register_node("evolution_core:primordial_matter", {
    description = "Primordial Matter",
    tiles = {tile("#5365d8")},
    groups = {dig_immediate = 3, oddly_breakable_by_hand = 1, evolution_sandbox = 1},
    light_source = 3,
})

action_node("chaos_core", "混沌核心（右键：观察）", "#854dff", "observe")
action_node("fracture", "撕裂场（右键：撕裂）", "#ef476f", "split")
action_node("fusion_field", "融合场（右键：融合）", "#06d6a0", "fuse")
action_node("dimension_gate", "维度门（右键：触发大爆炸）", "#ffd166", "big_bang")
action_node("creation_focus", "创造焦点（右键：创造）", "#55d6ff", "create")
action_node("destruction_focus", "毁灭焦点（右键：毁灭）", "#ff5a5f", "destroy")
action_node("stability_focus", "稳定焦点（右键：稳定时空）", "#8ce99a", "stabilize")
