-- SPDX-License-Identifier: GPL-3.0-or-later

local huds = {}
local FORMNAME = "evolution_core:panel"

local function escape(text)
    return minetest.formspec_escape(tostring(text or ""))
end

function evolution_core.refresh_hud(player)
    local name = player:get_player_name()
    local state = evolution_core.api.get_state(player)
    local text = "EVOLUTION  " .. evolution_core.api.status(state) .. "\n/evo 打开演化面板"
    if huds[name] then
        player:hud_change(huds[name], "text", text)
    else
        huds[name] = player:hud_add({
            type = "text",
            position = {x = 0.02, y = 0.06},
            offset = {x = 0, y = 0},
            alignment = {x = 1, y = 1},
            scale = {x = 100, y = 20},
            number = 0xE8EEFC,
            text = text,
        })
    end
end

function evolution_core.show_panel(player, message)
    local state = evolution_core.api.get_state(player)
    local phase = evolution_core.api.phase_definition(state.phase)
    local formspec = {
        "formspec_version[4]size[12,9]",
        "label[0.6,0.6;", escape("EvolutionSandbox · " .. phase.title), "]",
        "textarea[0.6,1.1;10.8,1.3;;状态;", escape(evolution_core.api.status(state)), "]",
        "textarea[0.6,2.2;10.8,1.4;;目标;", escape(phase.objective), "]",
    }
    local x, y = 0.6, 3.8
    for action_name, action in pairs(evolution_core.content.actions) do
        local allowed = false
        for _, value in ipairs(action.availableIn) do
            if value == state.phase then allowed = true end
        end
        if allowed then
            table.insert(formspec, "button[" .. x .. "," .. y .. ";3.4,0.8;act_" .. action_name .. ";" .. escape(action.title) .. "]")
            x = x + 3.7
            if x > 8 then x, y = 0.6, y + 1 end
        end
    end
    if state.phase == "first_3d" then
        table.insert(formspec, "field[0.6,6.8;4.4,0.8;branch_name;世界时间线;" .. escape(state.timeline) .. "]")
        table.insert(formspec, "button[5.2,6.8;2.0,0.8;save_branch;创建]")
        table.insert(formspec, "button[7.4,6.8;2.0,0.8;join_branch;加入]")
    end
    table.insert(formspec, "button[9.6,6.8;1.8,0.8;reset_state;重置]")
    table.insert(formspec, "textarea[0.6,7.8;10.8,0.8;;结果;" .. escape(message or "右键领域中的彩色节点也能执行行为。") .. "]")
    minetest.show_formspec(player:get_player_name(), FORMNAME, table.concat(formspec))
end

minetest.register_on_joinplayer(function(player)
    minetest.after(0, function()
        if player and player:is_player() then evolution_core.refresh_hud(player) end
    end)
end)

minetest.register_on_leaveplayer(function(player)
    huds[player:get_player_name()] = nil
end)

minetest.register_on_player_receive_fields(function(player, formname, fields)
    if formname ~= FORMNAME or fields.quit then return end
    local message
    for key, _ in pairs(fields) do
        local action = key:match("^act_([a-z][a-z0-9_]*)$")
        if action then
            local _ok
            _ok, message = evolution_core.perform_action(player, action)
            break
        end
    end
    if fields.save_branch then
        local actor_id = evolution_core.identity.actor_for_player(player)
        local result, _, err = evolution_core.timelines.create(
            player, actor_id, fields.branch_name,
            evolution_core.api.get_revision(player), evolution_core.timelines.get_revision())
        message = result and ("世界时间线已创建：" .. result.state.timeline) or err
        evolution_core.refresh_hud(player)
    elseif fields.join_branch then
        local actor_id = evolution_core.identity.actor_for_player(player)
        local result, _, err = evolution_core.timelines.join(
            player, actor_id, fields.branch_name,
            evolution_core.api.get_revision(player), evolution_core.timelines.get_revision())
        message = result and ("已加入时间线：" .. result.state.timeline) or err
        evolution_core.refresh_hud(player)
    elseif fields.reset_state then
        local _ok
        _ok, message = evolution_core.reset_player(player)
    end
    evolution_core.show_panel(player, message)
end)
