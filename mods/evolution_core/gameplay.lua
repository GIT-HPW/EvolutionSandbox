-- SPDX-License-Identifier: GPL-3.0-or-later

function evolution_core.perform_action(player, action_name)
    local state, err, event = evolution_core.api.apply_action(player, action_name)
    if not state then
        if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
        return false, err
    end
    if event.transitioned then evolution_core.realms.enter(player, state.phase) end
    if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
    return true, event.title .. "：" .. event.result
end

function evolution_core.start_player(player)
    local state = evolution_core.api.get_state(player)
    evolution_core.realms.enter(player, state.phase)
    if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
    return true, "已进入 EvolutionSandbox：" .. evolution_core.api.status(state)
end

function evolution_core.reset_player(player)
    local state = evolution_core.api.reset(player)
    evolution_core.realms.enter(player, state.phase)
    if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
    return true, "个人演化状态已重置；世界与其他玩家数据未被删除。"
end
