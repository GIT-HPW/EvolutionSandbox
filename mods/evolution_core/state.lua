-- SPDX-License-Identifier: GPL-3.0-or-later

local api = {}
local pack = evolution_core.content
local META_KEY = "evolution:state"

local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
end

local function phase_exists(id)
    for _, phase in ipairs(pack.phases) do
        if phase.id == id then return true end
    end
    return false
end

local function clamp(stat, value)
    local limit = pack.limits[stat]
    if type(value) ~= "number" or not limit then return value end
    return math.max(limit.min, math.min(limit.max, value))
end

local function normalize(value)
    if type(value) ~= "table" then return copy(pack.initialState) end
    local result = copy(pack.initialState)
    for key, initial in pairs(pack.initialState) do
        if type(value[key]) == type(initial) then result[key] = value[key] end
    end
    if not phase_exists(result.phase) then result.phase = pack.initialState.phase end
    if not result.timeline:match("^[%w_-]+$") or #result.timeline > 32 then result.timeline = "origin" end
    for stat, _ in pairs(pack.limits) do result[stat] = clamp(stat, result[stat]) end
    return result
end

function api.initial_state()
    return copy(pack.initialState)
end

function api.get_state(player)
    local encoded = player:get_meta():get_string(META_KEY)
    if encoded == "" then return api.initial_state() end
    local ok, value = pcall(minetest.parse_json, encoded)
    if not ok then return api.initial_state() end
    return normalize(value)
end

function api.save_state(player, state)
    state = normalize(state)
    player:get_meta():set_string(META_KEY, minetest.write_json(state))
    return state
end

local function action_available(action, phase)
    for _, allowed in ipairs(action.availableIn or {}) do
        if allowed == phase then return true end
    end
    return false
end

function api.apply_action(player, action_name)
    if type(action_name) ~= "string" or not action_name:match("^[a-z][a-z0-9_]*$") then
        return nil, "无效行为"
    end
    local action = pack.actions[action_name]
    if not action then return nil, "未知行为：" .. action_name end

    local state = api.get_state(player)
    if not action_available(action, state.phase) then
        return nil, "“" .. action.title .. "”不能在当前阶段执行"
    end
    for stat, required in pairs(action.requires or {}) do
        if (state[stat] or 0) < required then
            return nil, stat .. " 需要至少 " .. required .. "，当前为 " .. (state[stat] or 0)
        end
    end

    local previous_phase = state.phase
    for stat, delta in pairs(action.delta or {}) do
        state[stat] = clamp(stat, (state[stat] or 0) + delta)
    end
    for key, value in pairs(action.set or {}) do state[key] = value end
    state.steps = clamp("steps", state.steps + 1)
    state = api.save_state(player, state)

    return state, nil, {
        action = action_name,
        title = action.title,
        result = action.result,
        transitioned = previous_phase ~= state.phase,
        from_phase = previous_phase,
        to_phase = state.phase,
    }
end

function api.set_timeline(player, name)
    local state = api.get_state(player)
    if state.phase ~= "first_3d" then return nil, "进入三维领域后才能创建时间线" end
    name = (name or ""):match("^%s*(.-)%s*$")
    if name == "" or #name > 32 or not name:match("^[%w_-]+$") then
        return nil, "时间线名称只能包含字母、数字、下划线或连字符，最长 32 个字符"
    end
    state.timeline = name
    return api.save_state(player, state)
end

function api.reset(player)
    return api.save_state(player, api.initial_state())
end

function api.phase_definition(phase_id)
    for _, phase in ipairs(pack.phases) do
        if phase.id == phase_id then return phase end
    end
end

function api.status(state)
    return string.format(
        "阶段=%s 维度=%dD 能量=%d 信息=%d 熵=%d 稳定=%d 碎片=%d 时间线=%s",
        state.phase, state.dimension, state.energy, state.information,
        state.entropy, state.stability, state.fragments, state.timeline
    )
end

evolution_core.api = api
