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
    params = "[status|start|return|reset|branch <name>|observe|split|fuse|big_bang|create|destroy|stabilize]",
    func = function(name, param)
        local player = minetest.get_player_by_name(name)
        if not player then return false, "玩家不在线" end
        local command, argument = (param or ""):match("^%s*(%S*)%s*(.-)%s*$")
        if command == "" or command == "panel" then
            evolution_core.show_panel(player)
            return true, ""
        elseif command == "status" then
            return true, evolution_core.api.status(evolution_core.api.get_state(player))
        elseif command == "start" or command == "return" then
            return evolution_core.start_player(player)
        elseif command == "reset" then
            return evolution_core.reset_player(player)
        elseif command == "branch" then
            local state, err = evolution_core.api.set_timeline(player, argument)
            if not state then return false, err end
            evolution_core.refresh_hud(player)
            return true, "时间线已保存：" .. state.timeline
        elseif ACTIONS[command] then
            return evolution_core.perform_action(player, command)
        end
        return false, "未知命令；输入 /evo 打开可点击面板"
    end,
})
