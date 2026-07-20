-- SPDX-License-Identifier: GPL-3.0-or-later

local enabled = minetest.settings:get_bool("evolution_bridge_enabled", true)
local http = enabled and minetest.request_http_api() or nil
local storage = minetest.get_mod_storage()

if not enabled then
    minetest.log("action", "[evolution_bridge] disabled by configuration")
    return
end

if not http then
    minetest.log("error", "[evolution_bridge] HTTP API unavailable; add evolution_bridge to secure.http_mods and use a cURL-enabled Luanti build")
    return
end

local token = minetest.settings:get("evolution_bridge_token") or ""
if #token < 32 or #token > 256 or not token:match("^[%w%._~%-]+$") then
    minetest.log("error", "[evolution_bridge] evolution_bridge_token must contain 32-256 URL-safe ASCII characters; bridge remains inactive")
    return
end

local base_url = (minetest.settings:get("evolution_bridge_url") or "http://127.0.0.1:7070"):gsub("/+$", "")
if not base_url:match("^http://127%.0%.0%.1:%d+$") and not base_url:match("^http://%[::1%]:%d+$") then
    minetest.log("error", "[evolution_bridge] evolution_bridge_url must use 127.0.0.1 or [::1]; bridge remains inactive")
    return
end

local source = minetest.settings:get("evolution_bridge_source") or "esip://luanti/world-alpha"
local adapter_id = minetest.settings:get("evolution_bridge_adapter_id") or "luanti-world-alpha"
local universe_id = minetest.settings:get("evolution_bridge_universe_id") or "universe-1"
local allowed_source_text = minetest.settings:get("evolution_bridge_allowed_sources") or "esip://local/control"
local poll_interval = tonumber(minetest.settings:get("evolution_bridge_poll_interval")) or 1.0
local poll_batch = tonumber(minetest.settings:get("evolution_bridge_poll_batch")) or 4
poll_interval = math.max(0.2, math.min(30, poll_interval))
poll_batch = math.max(1, math.min(8, math.floor(poll_batch)))

local MAX_MESSAGE_BYTES = 64 * 1024
local MAX_HANDLED = 256
local ESIP_VERSION = "0.1"
local allowed_sources = {}
for value in allowed_source_text:gmatch("[^,%s]+") do allowed_sources[value] = true end

local TYPES = {
    hello = "io.evolution.capability.hello.v1",
    action_requested = "io.evolution.action.requested.v1",
    action_applied = "io.evolution.action.applied.v1",
    state_requested = "io.evolution.state.requested.v1",
    state_snapshot = "io.evolution.state.snapshot.v1",
    realm_transitioned = "io.evolution.realm.transitioned.v1",
    timeline_create_requested = "io.evolution.timeline.create.requested.v1",
    timeline_created_v2 = "io.evolution.timeline.created.v2",
    timeline_join_requested = "io.evolution.timeline.join.requested.v1",
    timeline_joined = "io.evolution.timeline.joined.v1",
    timeline_registry_requested = "io.evolution.timeline.registry.requested.v1",
    timeline_registry_snapshot = "io.evolution.timeline.registry.snapshot.v1",
    error = "io.evolution.error.v1",
}

local SCHEMAS = {
    [TYPES.hello] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/capability-hello-v1.schema.json",
    [TYPES.action_requested] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/action-requested-v1.schema.json",
    [TYPES.action_applied] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/action-applied-v1.schema.json",
    [TYPES.state_requested] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/state-requested-v1.schema.json",
    [TYPES.state_snapshot] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/state-snapshot-v1.schema.json",
    [TYPES.realm_transitioned] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/realm-transitioned-v1.schema.json",
    [TYPES.timeline_create_requested] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-create-requested-v1.schema.json",
    [TYPES.timeline_created_v2] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-created-v2.schema.json",
    [TYPES.timeline_join_requested] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-join-requested-v1.schema.json",
    [TYPES.timeline_joined] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-joined-v1.schema.json",
    [TYPES.timeline_registry_requested] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-registry-requested-v1.schema.json",
    [TYPES.timeline_registry_snapshot] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/timeline-registry-snapshot-v1.schema.json",
    [TYPES.error] = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/error-v1.schema.json",
}

local ACTIONS = {
    observe = true,
    split = true,
    fuse = true,
    big_bang = true,
    create = true,
    destroy = true,
    stabilize = true,
}

local ENVELOPE_FIELDS = {
    specversion = true, esipversion = true, id = true, source = true, type = true,
    kind = true, time = true, subject = true, target = true, datacontenttype = true,
    dataschema = true, sequence = true, tick = true, correlationid = true,
    causationid = true, expiresat = true, data = true,
}
local CONTEXT_FIELDS = { universeId = true, timelineId = true, realmId = true, actorId = true }

local function valid_id(value)
    return type(value) == "string" and #value >= 1 and #value <= 128
        and value:match("^[%w][%w%._:%-]*$") ~= nil
end

local function valid_uri(value)
    return type(value) == "string" and #value <= 255
        and value:match("^[a-z][a-z0-9+%.%-]*://[^%s]+$") ~= nil
end

if not valid_uri(source) or not valid_id(adapter_id) or not valid_id(universe_id) or next(allowed_sources) == nil then
    minetest.log("error", "[evolution_bridge] source, adapter, universe or allowed-source configuration is invalid")
    return
end

local function integer(value)
    return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function reject_unknown(value, allowed)
    if type(value) ~= "table" then return false end
    for key, _ in pairs(value) do
        if type(key) ~= "string" or not allowed[key] then return false end
    end
    return true
end

local function clean_message(value)
    value = tostring(value or "error"):gsub("[%z\1-\31]", " ")
    return value:sub(1, 512)
end

local function validate_context(context, require_realm)
    if not reject_unknown(context, CONTEXT_FIELDS) then return nil, "invalid_context", "context contains unsupported fields" end
    if context.universeId ~= universe_id then return nil, "wrong_universe", "context universe does not match this world" end
    if not valid_id(context.timelineId) or not valid_id(context.actorId) then
        return nil, "invalid_context", "timelineId and actorId must be valid identifiers"
    end
    if require_realm and not valid_id(context.realmId) then return nil, "invalid_context", "realmId is required" end
    if context.realmId ~= nil and not valid_id(context.realmId) then return nil, "invalid_context", "realmId is invalid" end
    return true
end

local function validate_command(message)
    if not reject_unknown(message, ENVELOPE_FIELDS) then return nil, "invalid_message", "message envelope is invalid" end
    if message.specversion ~= "1.0" or message.esipversion ~= ESIP_VERSION then
        return nil, "unsupported_version", "unsupported CloudEvents or ESIP version"
    end
    if not valid_id(message.id) or not valid_uri(message.source) or not allowed_sources[message.source] then
        return nil, "forbidden", "message id or source is not allowed"
    end
    if message.target ~= source and message.target ~= adapter_id then return nil, "forbidden", "message target does not match this adapter" end
    if not integer(message.sequence) or type(message.time) ~= "string" or type(message.expiresat) ~= "string" then
        return nil, "invalid_message", "sequence, time or expiresat is invalid"
    end
    if message.datacontenttype ~= "application/json" or message.dataschema ~= SCHEMAS[message.type] then
        return nil, "schema_mismatch", "message schema binding is invalid"
    end
    if type(message.data) ~= "table" then return nil, "invalid_message", "message data must be an object" end

    if message.type == TYPES.action_requested then
        if message.kind ~= "command" then return nil, "kind_mismatch", "action request must be a command" end
        local allowed = { context = true, actionId = true, parameters = true, expectedRevision = true }
        if not reject_unknown(message.data, allowed) then return nil, "invalid_message", "action data contains unsupported fields" end
        local ok, code, reason = validate_context(message.data.context, true)
        if not ok then return nil, code, reason end
        if not ACTIONS[message.data.actionId] then return nil, "unknown_action", "action is not in the Evolution whitelist" end
        if type(message.data.parameters) ~= "table" or next(message.data.parameters) ~= nil then
            return nil, "invalid_parameters", "current Evolution actions do not accept parameters"
        end
        if not integer(message.data.expectedRevision) then return nil, "invalid_revision", "expectedRevision must be a non-negative integer" end
        return true
    end

    if message.type == TYPES.state_requested then
        if message.kind ~= "query" then return nil, "kind_mismatch", "state request must be a query" end
        local allowed = { context = true, fields = true }
        if not reject_unknown(message.data, allowed) then return nil, "invalid_message", "state query contains unsupported fields" end
        local ok, code, reason = validate_context(message.data.context, false)
        if not ok then return nil, code, reason end
        if message.data.fields ~= nil then
            if type(message.data.fields) ~= "table" then return nil, "invalid_fields", "fields must be an array" end
            for index, field in ipairs(message.data.fields) do
                if index > 32 or type(field) ~= "string" or #field > 64 then return nil, "invalid_fields", "fields array is invalid" end
            end
        end
        return true
    end

    if message.type == TYPES.timeline_create_requested then
        if message.kind ~= "command" then return nil, "kind_mismatch", "timeline create request must be a command" end
        local allowed = { context = true, newTimelineId = true, expectedStateRevision = true, expectedRegistryRevision = true }
        if not reject_unknown(message.data, allowed) then return nil, "invalid_message", "timeline create data contains unsupported fields" end
        local ok, code, reason = validate_context(message.data.context, true)
        if not ok then return nil, code, reason end
        if not valid_id(message.data.newTimelineId) or #message.data.newTimelineId > 32
                or not message.data.newTimelineId:match("^[%w_-]+$") then
            return nil, "invalid_timeline", "newTimelineId is invalid"
        end
        if not integer(message.data.expectedStateRevision) or not integer(message.data.expectedRegistryRevision) then
            return nil, "invalid_revision", "timeline revisions must be non-negative integers"
        end
        return true
    end

    if message.type == TYPES.timeline_join_requested then
        if message.kind ~= "command" then return nil, "kind_mismatch", "timeline join request must be a command" end
        local allowed = { context = true, targetTimelineId = true, expectedStateRevision = true, expectedRegistryRevision = true }
        if not reject_unknown(message.data, allowed) then return nil, "invalid_message", "timeline join data contains unsupported fields" end
        local ok, code, reason = validate_context(message.data.context, true)
        if not ok then return nil, code, reason end
        if not valid_id(message.data.targetTimelineId) then return nil, "invalid_timeline", "targetTimelineId is invalid" end
        if not integer(message.data.expectedStateRevision) or not integer(message.data.expectedRegistryRevision) then
            return nil, "invalid_revision", "timeline revisions must be non-negative integers"
        end
        return true
    end

    if message.type == TYPES.timeline_registry_requested then
        if message.kind ~= "query" then return nil, "kind_mismatch", "timeline registry request must be a query" end
        local allowed = { context = true, afterRevision = true }
        if not reject_unknown(message.data, allowed) then return nil, "invalid_message", "timeline registry query contains unsupported fields" end
        local ok, code, reason = validate_context(message.data.context, false)
        if not ok then return nil, code, reason end
        if not integer(message.data.afterRevision) then return nil, "invalid_revision", "afterRevision must be a non-negative integer" end
        return true
    end
    return nil, "unknown_type", "only declared Evolution commands and queries are accepted"
end

local function next_sequence()
    local value = math.max(0, storage:get_int("sequence"))
    storage:set_int("sequence", value + 1)
    return value
end

local function iso_time()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function make_message(message_type, kind, data, options)
    options = options or {}
    local sequence = next_sequence()
    local message = {
        specversion = "1.0",
        esipversion = ESIP_VERSION,
        id = "luanti-" .. sequence .. "-" .. tostring(minetest.get_us_time()),
        source = source,
        type = message_type,
        kind = kind,
        time = iso_time(),
        datacontenttype = "application/json",
        dataschema = SCHEMAS[message_type],
        sequence = sequence,
        data = data,
    }
    for _, key in ipairs({ "subject", "target", "correlationid", "causationid" }) do
        if options[key] ~= nil then message[key] = options[key] end
    end
    return message
end

local handled = { order = {}, responses = {} }
do
    local encoded = storage:get_string("handled_commands")
    if encoded ~= "" then
        local ok, value = pcall(minetest.parse_json, encoded)
        if ok and type(value) == "table" and type(value.order) == "table" and type(value.responses) == "table" then
            handled = value
        end
    end
end

local function save_handled()
    storage:set_string("handled_commands", minetest.write_json(handled))
end

local function remember(command, descriptor)
    if not handled.responses[command.id] then table.insert(handled.order, command.id) end
    handled.responses[command.id] = {
        source = command.source,
        type = command.type,
        fingerprint = command.__bridge_fingerprint,
        descriptor = descriptor,
    }
    while #handled.order > MAX_HANDLED do
        local removed = table.remove(handled.order, 1)
        handled.responses[removed] = nil
    end
    save_handled()
end

local outbound = {}
local sending = false
local retry_delay = 1
local flush_outbound

local function headers(include_json)
    local result = { "Authorization: Bearer " .. token, "Accept: application/json" }
    if include_json then table.insert(result, "Content-Type: application/json") end
    return result
end

local function enqueue(message)
    table.insert(outbound, message)
    minetest.after(0, function()
        if flush_outbound then flush_outbound() end
    end)
end

flush_outbound = function()
    if sending or #outbound == 0 then return end
    sending = true
    local encoded = minetest.write_json(outbound[1])
    http.fetch({
        url = base_url .. "/v1/messages",
        method = "POST",
        data = encoded,
        timeout = 5,
        quiet = true,
        extra_headers = headers(true),
    }, function(response)
        sending = false
        local response_code = tonumber(response.code) or 0
        local success = response.succeeded and response_code >= 200 and response_code < 300
        if success then
            table.remove(outbound, 1)
            retry_delay = 1
            minetest.after(0, flush_outbound)
            return
        end
        if response_code >= 400 and response_code < 500 and response_code ~= 408 and response_code ~= 429 then
            minetest.log("error", "[evolution_bridge] sidecar rejected an outbound ESIP message with HTTP " .. response_code)
            table.remove(outbound, 1)
            retry_delay = 1
            minetest.after(0, flush_outbound)
            return
        end
        retry_delay = math.min(30, retry_delay * 2)
        minetest.after(retry_delay, flush_outbound)
    end)
end

local function descriptor_for(command, message_type, kind, data)
    return {
        message_type = message_type,
        kind = kind,
        data = data,
        options = {
            subject = command.subject,
            target = command.source,
            correlationid = command.correlationid or command.id,
            causationid = command.id,
        },
    }
end

local function emit_descriptor(descriptor)
    enqueue(make_message(descriptor.message_type, descriptor.kind, descriptor.data, descriptor.options))
end

local function respond(command, message_type, kind, data)
    local descriptor = descriptor_for(command, message_type, kind, data)
    remember(command, descriptor)
    emit_descriptor(descriptor)
end

local function respond_error(command, code, message, retryable)
    respond(command, TYPES.error, "result", {
        respondingTo = command.id,
        code = code,
        message = clean_message(message),
        retryable = retryable == true,
    })
end

local function current_context(state, actor_id)
    return {
        universeId = universe_id,
        timelineId = state.timeline,
        realmId = state.phase,
        actorId = actor_id,
    }
end

local function process_command(command)
    local encoded = minetest.write_json(command)
    if #encoded > MAX_MESSAGE_BYTES then
        minetest.log("warning", "[evolution_bridge] dropped an oversized command")
        return
    end
    local ok, code, reason = validate_command(command)
    if not ok then
        if valid_id(command.id) and valid_uri(command.source) and allowed_sources[command.source] then
            respond_error(command, code, reason, false)
        else
            minetest.log("warning", "[evolution_bridge] dropped an invalid command envelope")
        end
        return
    end

    command.__bridge_fingerprint = minetest.sha1(encoded)

    local cached = handled.responses[command.id]
    if cached then
        if cached.source == command.source and cached.type == command.type
                and cached.fingerprint == command.__bridge_fingerprint then
            emit_descriptor(cached.descriptor)
        else
            emit_descriptor(descriptor_for(command, TYPES.error, "result", {
                respondingTo = command.id,
                code = "id_conflict",
                message = "command id was reused with different content",
                retryable = false,
            }))
        end
        return
    end

    local actor_id = command.data.context.actorId
    local player_name = evolution_core.identity.resolve_actor(actor_id)
    if not player_name then
        respond_error(command, "identity_unmapped", "actorId is not bound to a local player", false)
        return
    end
    local player = minetest.get_player_by_name(player_name)
    if not player then
        respond_error(command, "actor_offline", "target player is not online", true)
        return
    end

    local state = evolution_core.api.get_state(player)
    local revision = evolution_core.api.get_revision(player)
    if command.type == TYPES.state_requested then
        respond(command, TYPES.state_snapshot, "result", {
            context = current_context(state, actor_id),
            respondingTo = command.id,
            revision = revision,
            state = state,
        })
        return
    end

    if command.type == TYPES.timeline_registry_requested then
        local snapshot, snapshot_code, snapshot_message, snapshot_retryable = evolution_core.timelines.snapshot(command.data.afterRevision)
        if not snapshot then
            respond_error(command, snapshot_code, snapshot_message, snapshot_retryable)
            return
        end
        respond(command, TYPES.timeline_registry_snapshot, "result", {
            context = current_context(state, actor_id),
            respondingTo = command.id,
            registryRevision = snapshot.registryRevision,
            timelines = snapshot.timelines,
            events = snapshot.events,
            truncated = snapshot.truncated,
        })
        return
    end

    if command.data.context.realmId ~= state.phase or command.data.context.timelineId ~= state.timeline then
        respond_error(command, "context_conflict", "realm or timeline does not match current player state", true)
        return
    end

    if command.type == TYPES.timeline_create_requested then
        local result, timeline_code, timeline_message, timeline_retryable = evolution_core.timelines.create(
            player, actor_id, command.data.newTimelineId,
            command.data.expectedStateRevision, command.data.expectedRegistryRevision)
        if not result then
            respond_error(command, timeline_code, timeline_message, timeline_retryable)
            return
        end
        if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
        respond(command, TYPES.timeline_created_v2, "event", {
            context = current_context(result.state, actor_id),
            commandId = command.id,
            parentTimelineId = result.entry.parentTimelineId,
            newTimelineId = result.entry.timelineId,
            createdByActorId = actor_id,
            stateRevision = result.stateRevision,
            registryRevision = result.registryRevision,
        })
        return
    end

    if command.type == TYPES.timeline_join_requested then
        local result, timeline_code, timeline_message, timeline_retryable = evolution_core.timelines.join(
            player, actor_id, command.data.targetTimelineId,
            command.data.expectedStateRevision, command.data.expectedRegistryRevision)
        if not result then
            respond_error(command, timeline_code, timeline_message, timeline_retryable)
            return
        end
        if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
        respond(command, TYPES.timeline_joined, "event", {
            context = current_context(result.state, actor_id),
            commandId = command.id,
            fromTimelineId = result.fromTimelineId,
            toTimelineId = result.toTimelineId,
            stateRevision = result.stateRevision,
            registryRevision = result.registryRevision,
        })
        return
    end

    if command.data.expectedRevision ~= revision then
        respond_error(command, "revision_conflict",
            "expected revision " .. command.data.expectedRevision .. ", current revision is " .. revision, true)
        return
    end
    local previous = state
    local result, action_error, event = evolution_core.api.apply_action(player, command.data.actionId)
    if not result then
        respond_error(command, "rule_error", action_error, false)
        return
    end
    if event.transitioned then evolution_core.realms.enter(player, result.phase) end
    if evolution_core.refresh_hud then evolution_core.refresh_hud(player) end
    revision = evolution_core.api.get_revision(player)
    local context = current_context(result, actor_id)
    respond(command, TYPES.action_applied, "event", {
        context = context,
        commandId = command.id,
        actionId = command.data.actionId,
        outcome = "applied",
        revision = revision,
        state = result,
    })
    if event.transitioned then
        enqueue(make_message(TYPES.realm_transitioned, "event", {
            context = context,
            fromRealm = event.from_phase,
            toRealm = event.to_phase,
            fromDimension = previous.dimension,
            toDimension = result.dimension,
            revision = revision,
        }, {
            subject = command.subject,
            target = command.source,
            correlationid = command.correlationid or command.id,
            causationid = command.id,
        }))
    end
end

local function url_encode(value)
    return (value:gsub("([^%w%-%._~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end))
end

local poll_in_flight = false
local connected = false
local function poll()
    if poll_in_flight then return end
    poll_in_flight = true
    http.fetch({
        url = base_url .. "/v1/commands?target=" .. url_encode(source) .. "&limit=" .. poll_batch,
        method = "GET",
        timeout = 5,
        quiet = true,
        extra_headers = headers(false),
    }, function(response)
        poll_in_flight = false
        if response.succeeded and response.code == 200 and type(response.data) == "string"
                and #response.data <= (MAX_MESSAGE_BYTES * poll_batch + 4096) then
            if not connected then
                connected = true
                minetest.log("action", "[evolution_bridge] connected to local ESIP sidecar")
            end
            local ok, body = pcall(minetest.parse_json, response.data)
            if ok and type(body) == "table" and type(body.messages) == "table" then
                for index, command in ipairs(body.messages) do
                    if index > poll_batch then break end
                    local processed, err = pcall(process_command, command)
                    if not processed then minetest.log("error", "[evolution_bridge] command processing failed: " .. clean_message(err)) end
                end
            else
                minetest.log("warning", "[evolution_bridge] sidecar returned invalid JSON")
            end
        elseif connected then
            connected = false
            minetest.log("warning", "[evolution_bridge] local ESIP sidecar is unavailable")
        end
        minetest.after(poll_interval, poll)
    end)
end

minetest.register_chatcommand("esip_status", {
    description = "Show Evolution ESIP bridge status",
    privs = { server = true },
    func = function()
        return true, string.format("ESIP bridge=%s target=%s outbound=%d", connected and "connected" or "waiting", source, #outbound)
    end,
})

enqueue(make_message(TYPES.hello, "event", {
    adapterId = adapter_id,
    platform = "luanti",
    protocolVersions = { ESIP_VERSION },
    consumes = {
        TYPES.action_requested,
        TYPES.state_requested,
        TYPES.timeline_create_requested,
        TYPES.timeline_join_requested,
        TYPES.timeline_registry_requested,
    },
    produces = {
        TYPES.action_applied,
        TYPES.state_snapshot,
        TYPES.realm_transitioned,
        TYPES.timeline_created_v2,
        TYPES.timeline_joined,
        TYPES.timeline_registry_snapshot,
        TYPES.error,
    },
    maxMessageBytes = MAX_MESSAGE_BYTES,
}))
minetest.after(0.5, poll)
minetest.log("action", "[evolution_bridge] authenticated loopback ESIP bridge loaded")
