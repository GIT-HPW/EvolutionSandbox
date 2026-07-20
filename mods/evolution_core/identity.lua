-- SPDX-License-Identifier: GPL-3.0-or-later

local identity = {}
local storage = minetest.get_mod_storage()
local META_KEY = "evolution:actor_id"
local STORAGE_KEY = "identity_registry_v1"

local function valid_id(value)
    return type(value) == "string" and #value >= 1 and #value <= 128
        and value:match("^[%w][%w%._:%-]*$") ~= nil
end

local registry = { schema = 1, bindings = {} }
local healthy = true

local function valid_registry(value)
    if type(value) ~= "table" or value.schema ~= 1 or type(value.bindings) ~= "table" or #value.bindings > 1024 then return false end
    local actors, players = {}, {}
    for _, binding in ipairs(value.bindings) do
        if type(binding) ~= "table" or not valid_id(binding.actorId)
                or type(binding.playerName) ~= "string" or not minetest.is_valid_player_name(binding.playerName)
                or actors[binding.actorId] or players[binding.playerName] then return false end
        actors[binding.actorId] = true
        players[binding.playerName] = true
    end
    return true
end
do
    local encoded = storage:get_string(STORAGE_KEY)
    if encoded ~= "" then
        local ok, value = pcall(minetest.parse_json, encoded)
        if ok and valid_registry(value) then
            registry = value
        else
            healthy = false
            minetest.log("error", "[evolution_core] identity registry is invalid; existing bindings are unavailable")
        end
    end
end

local function save()
    storage:set_string(STORAGE_KEY, minetest.write_json(registry))
end

local function find_by_actor(actor_id)
    for _, binding in ipairs(registry.bindings) do
        if binding.actorId == actor_id then return binding end
    end
end

local function find_by_player(player_name)
    for _, binding in ipairs(registry.bindings) do
        if binding.playerName == player_name then return binding end
    end
end

local salt = storage:get_string("identity_salt")
if salt == "" then
    salt = minetest.sha1(minetest.get_worldpath() .. ":" .. tostring(minetest.get_us_time()))
    storage:set_string("identity_salt", salt)
end

function identity.bind(player, actor_id)
    if not healthy then return nil, "registry_unavailable", "身份注册表不可用" end
    if not player or not player:is_player() then return nil, "invalid_player", "玩家对象无效" end
    if not valid_id(actor_id) then return nil, "invalid_actor", "actorId 格式无效" end
    local player_name = player:get_player_name()
    local actor_binding = find_by_actor(actor_id)
    if actor_binding and actor_binding.playerName ~= player_name then
        return nil, "identity_conflict", "actorId 已绑定到其他本地玩家"
    end
    local player_binding = find_by_player(player_name)
    if player_binding and player_binding.actorId ~= actor_id then
        return nil, "identity_conflict", "本地玩家已绑定到其他 actorId"
    end
    if not actor_binding then
        table.insert(registry.bindings, { actorId = actor_id, playerName = player_name })
        save()
    end
    player:get_meta():set_string(META_KEY, actor_id)
    return actor_id
end

function identity.actor_for_player(player)
    if not healthy then return nil end
    if not player or not player:is_player() then return nil end
    local player_name = player:get_player_name()
    local stored = player:get_meta():get_string(META_KEY)
    if valid_id(stored) then
        local bound = find_by_actor(stored)
        if bound and bound.playerName == player_name then return stored end
    end
    local existing = find_by_player(player_name)
    if existing then
        player:get_meta():set_string(META_KEY, existing.actorId)
        return existing.actorId
    end
    local actor_id = "actor-" .. minetest.sha1(salt .. ":" .. player_name):sub(1, 24)
    local result = identity.bind(player, actor_id)
    return result
end

function identity.resolve_actor(actor_id)
    if not healthy then return nil end
    if not valid_id(actor_id) then return nil end
    local binding = find_by_actor(actor_id)
    return binding and binding.playerName or nil
end

function identity.snapshot()
    local result = {}
    for _, binding in ipairs(registry.bindings) do
        table.insert(result, { actorId = binding.actorId, playerName = binding.playerName })
    end
    return result
end

minetest.register_on_joinplayer(function(player)
    identity.actor_for_player(player)
end)

evolution_core.identity = identity
