-- SPDX-License-Identifier: GPL-3.0-or-later

local timelines = {}
local storage = minetest.get_mod_storage()
local STORAGE_KEY = "timeline_registry_v1"
local EVENT_LIMIT = 256

local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
end

local function valid_timeline(value)
    return type(value) == "string" and #value >= 1 and #value <= 32
        and value:match("^[%w_-]+$") ~= nil
end

local function integer(value)
    return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function initial_registry()
    return {
        schema = 1,
        revision = 0,
        timelines = { { timelineId = "origin", createdByActorId = "system", registryRevision = 0 } },
        events = {},
    }
end

local function valid_actor(value)
    return type(value) == "string" and #value >= 1 and #value <= 128
        and value:match("^[%w][%w%._:%-]*$") ~= nil
end

local function valid_entry(entry, revision)
    return type(entry) == "table" and valid_timeline(entry.timelineId)
        and (entry.parentTimelineId == nil or valid_timeline(entry.parentTimelineId))
        and valid_actor(entry.createdByActorId) and integer(entry.registryRevision)
        and entry.registryRevision <= revision
end

local function valid_registry(value)
    if type(value) ~= "table" or value.schema ~= 1 or not integer(value.revision)
            or type(value.timelines) ~= "table" or #value.timelines < 1 or #value.timelines > 256
            or type(value.events) ~= "table" or #value.events > EVENT_LIMIT then return false end
    local ids = {}
    for _, entry in ipairs(value.timelines) do
        if not valid_entry(entry, value.revision) or ids[entry.timelineId] then return false end
        ids[entry.timelineId] = true
    end
    if not ids.origin then return false end
    for _, entry in ipairs(value.events) do
        if not valid_entry(entry, value.revision) then return false end
    end
    return true
end

local registry = initial_registry()
local healthy = true
do
    local encoded = storage:get_string(STORAGE_KEY)
    if encoded ~= "" then
        local ok, value = pcall(minetest.parse_json, encoded)
        if ok and valid_registry(value) then
            registry = value
        else
            healthy = false
            minetest.log("error", "[evolution_core] timeline registry is invalid; timeline mutations are disabled")
        end
    end
end

local function save()
    storage:set_string(STORAGE_KEY, minetest.write_json(registry))
end

local function find(timeline_id)
    for _, entry in ipairs(registry.timelines) do
        if entry.timelineId == timeline_id then return entry end
    end
end

local function preflight(player, actor_id, expected_state_revision, expected_registry_revision)
    if not healthy then return nil, "registry_unavailable", "时间线注册表不可用", true end
    if not integer(expected_state_revision) or not integer(expected_registry_revision) then
        return nil, "invalid_revision", "revision 必须是非负整数", false
    end
    local state = evolution_core.api.get_state(player)
    local state_revision = evolution_core.api.get_revision(player)
    if state_revision ~= expected_state_revision then
        return nil, "revision_conflict", "玩家状态 revision 已变化", true
    end
    if registry.revision ~= expected_registry_revision then
        return nil, "registry_revision_conflict", "时间线注册表 revision 已变化", true
    end
    if state.phase ~= "first_3d" then return nil, "wrong_phase", "进入三维领域后才能操作时间线", false end
    if evolution_core.identity.resolve_actor(actor_id) ~= player:get_player_name() then
        return nil, "actor_mismatch", "actorId 与本地玩家绑定不一致", false
    end
    return state
end

function timelines.get_revision()
    return registry.revision
end

function timelines.exists(timeline_id)
    return find(timeline_id) ~= nil
end

function timelines.ensure_player_timeline(player, actor_id)
    if not healthy or not player or not player:is_player() then return false end
    local state = evolution_core.api.get_state(player)
    if state.timeline == "origin" or find(state.timeline) then return true end
    if not valid_timeline(state.timeline) or #registry.timelines >= 256 then return false end
    registry.revision = registry.revision + 1
    local entry = {
        timelineId = state.timeline,
        parentTimelineId = "origin",
        createdByActorId = actor_id,
        registryRevision = registry.revision,
    }
    table.insert(registry.timelines, entry)
    table.insert(registry.events, entry)
    while #registry.events > EVENT_LIMIT do table.remove(registry.events, 1) end
    save()
    minetest.log("action", "[evolution_core] migrated legacy player timeline " .. state.timeline)
    return true
end

function timelines.snapshot(after_revision)
    after_revision = tonumber(after_revision) or 0
    if not integer(after_revision) or after_revision > registry.revision then
        return nil, "registry_revision_ahead", "afterRevision 超出当前注册表 revision", true
    end
    local earliest = registry.events[1] and registry.events[1].registryRevision or (registry.revision + 1)
    local events = {}
    for _, entry in ipairs(registry.events) do
        if entry.registryRevision > after_revision then table.insert(events, copy(entry)) end
    end
    return {
        registryRevision = registry.revision,
        timelines = copy(registry.timelines),
        events = events,
        truncated = after_revision < (earliest - 1),
    }
end

function timelines.create(player, actor_id, new_timeline_id, expected_state_revision, expected_registry_revision)
    local state, code, message, retryable = preflight(player, actor_id, expected_state_revision, expected_registry_revision)
    if not state then return nil, code, message, retryable end
    if not valid_timeline(new_timeline_id) then return nil, "invalid_timeline", "时间线名称格式无效", false end
    if find(new_timeline_id) then return nil, "timeline_exists", "时间线已存在", false end
    if #registry.timelines >= 256 then return nil, "timeline_limit", "世界时间线数量已达到上限", false end
    local parent_timeline_id = state.timeline
    local updated, err = evolution_core.api.set_timeline(player, new_timeline_id)
    if not updated then return nil, "rule_error", err, false end
    registry.revision = registry.revision + 1
    local entry = {
        timelineId = new_timeline_id,
        parentTimelineId = parent_timeline_id,
        createdByActorId = actor_id,
        registryRevision = registry.revision,
    }
    table.insert(registry.timelines, entry)
    table.insert(registry.events, entry)
    while #registry.events > EVENT_LIMIT do table.remove(registry.events, 1) end
    save()
    return {
        state = updated,
        stateRevision = evolution_core.api.get_revision(player),
        registryRevision = registry.revision,
        entry = copy(entry),
    }
end

function timelines.join(player, actor_id, target_timeline_id, expected_state_revision, expected_registry_revision)
    local state, code, message, retryable = preflight(player, actor_id, expected_state_revision, expected_registry_revision)
    if not state then return nil, code, message, retryable end
    if not find(target_timeline_id) then return nil, "timeline_not_found", "目标时间线不存在", true end
    if state.timeline == target_timeline_id then return nil, "timeline_already_joined", "玩家已在目标时间线", false end
    local from_timeline_id = state.timeline
    local updated, err = evolution_core.api.set_timeline(player, target_timeline_id)
    if not updated then return nil, "rule_error", err, false end
    return {
        state = updated,
        stateRevision = evolution_core.api.get_revision(player),
        registryRevision = registry.revision,
        fromTimelineId = from_timeline_id,
        toTimelineId = target_timeline_id,
    }
end

minetest.register_on_joinplayer(function(player)
    minetest.after(0, function()
        if player and player:is_player() then
            local actor_id = evolution_core.identity.actor_for_player(player)
            if actor_id then timelines.ensure_player_timeline(player, actor_id) end
        end
    end)
end)

evolution_core.timelines = timelines
