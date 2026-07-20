-- SPDX-License-Identifier: GPL-3.0-or-later

local ACTIONS = {
    observe = true,
    split = true,
    fuse = true,
    big_bang = true,
    create = true,
    destroy = true,
    stabilize = true,
}

minetest.register_chatcommand("evo", {
    description = "Open or control the EvolutionSandbox origin loop",
    params = "[status|identity|timelines|start|return|reset|branch <name>|join <name>|observe|split|fuse|big_bang|create|destroy|stabilize]",
    func = function(name, param)
        local player = minetest.get_player_by_name(name)
        if not player then return false, "玩家不在线" end
        local command, argument = (param or ""):match("^%s*(%S*)%s*(.-)%s*$")
        if command == "" or command == "panel" then
            evolution_core.show_panel(player)
            return true, ""
        elseif command == "status" then
            return true, evolution_core.api.status(evolution_core.api.get_state(player))
        elseif command == "identity" then
            local actor_id = evolution_core.identity.actor_for_player(player)
            if not actor_id then return false, "身份注册表不可用" end
            return true, "ESIP actorId=" .. actor_id
        elseif command == "timelines" then
            local snapshot, _, message = evolution_core.timelines.snapshot(0)
            if not snapshot then return false, message end
            local names = {}
            for _, entry in ipairs(snapshot.timelines) do table.insert(names, entry.timelineId) end
            return true, "时间线 registry r" .. snapshot.registryRevision .. "：" .. table.concat(names, ", ")
        elseif command == "start" or command == "return" then
            return evolution_core.start_player(player)
        elseif command == "reset" then
            return evolution_core.reset_player(player)
        elseif command == "branch" then
            local actor_id = evolution_core.identity.actor_for_player(player)
            if not actor_id then return false, "身份注册表不可用" end
            local result, _, message = evolution_core.timelines.create(
                player, actor_id, argument,
                evolution_core.api.get_revision(player), evolution_core.timelines.get_revision())
            if not result then return false, message end
            evolution_core.refresh_hud(player)
            return true, "世界时间线已创建：" .. result.state.timeline .. "（registry r" .. result.registryRevision .. "）"
        elseif command == "join" then
            local actor_id = evolution_core.identity.actor_for_player(player)
            if not actor_id then return false, "身份注册表不可用" end
            local result, _, message = evolution_core.timelines.join(
                player, actor_id, argument,
                evolution_core.api.get_revision(player), evolution_core.timelines.get_revision())
            if not result then return false, message end
            evolution_core.refresh_hud(player)
            return true, "已加入时间线：" .. result.state.timeline
        elseif ACTIONS[command] then
            return evolution_core.perform_action(player, command)
        end
        return false, "未知命令；输入 /evo 打开可点击面板"
    end,
})
