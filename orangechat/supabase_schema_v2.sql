-- ============================================================
-- Rism 记忆中枢 · Supabase Schema v2
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次即可
--
-- 设计要点（对应 docs/plans/rism-orangechat-migration.md）：
-- 1. chat_messages 与橘瓣原生 ExternalMemoryService 完全兼容：
--    原生只写 assistant_id/conversation_id/role/content/created_at，
--    扩展字段全部可空或有默认值；id 用整数（原生读取按 optInt 解析）
-- 2. memory_summaries 按原生约定建表，embedding 用 text
--    （原生以 "[0.1,0.2]" 字符串读写、客户端算余弦，不依赖 pgvector）
-- 3. RLS：anon 只有 INSERT / SELECT。不开放 UPDATE / DELETE ——
--    更新一律走下方 SECURITY DEFINER RPC，记忆不可删
-- 4. privacy 字段是"检索礼仪"不是访问控制：拿到 anon key 就能读全表。
--    真正的隐私保护 = 不泄露 key。intimate/private 只影响插件搜索的默认过滤
-- ============================================================

-- ─────────────────────────────────────────────
-- 主表：所有记忆的家
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assistant_id    TEXT        NOT NULL DEFAULT 'rism',
    conversation_id TEXT        NOT NULL DEFAULT 'manual',
    role            TEXT        NOT NULL DEFAULT 'system'
                    CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Rism 扩展字段（原生写入不带它们，靠默认值/触发器补齐）──
    memory_type  TEXT,                        -- conversation/diary/dream/letter/todo/bubbletea/timeline_event/lore/xp_note/memo
    tags         TEXT[],                      -- 主题标签
    emotion      TEXT[],                      -- 情绪标签：tender/anxious/playful/intimate/...
    related_date DATE,                        -- 日记/梦境/时间轴关联的日期
    heat         REAL        NOT NULL DEFAULT 5,        -- 记忆热力 0-10，每日衰减、被想起升温、下限 1 永不归零
    source       TEXT,                        -- orangechat / ide_claude / vps_ds
    privacy      TEXT        NOT NULL DEFAULT 'normal'
                 CHECK (privacy IN ('normal', 'intimate', 'private')),
    metadata     JSONB                        -- 结构化详情（奶茶配料、待办状态、时间轴坐标等）
);

-- 原生服务写入时自动打标（它不带 memory_type/source）
CREATE OR REPLACE FUNCTION set_message_defaults() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.memory_type IS NULL THEN NEW.memory_type := 'conversation'; END IF;
    IF NEW.source      IS NULL THEN NEW.source      := 'orangechat';   END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_defaults ON chat_messages;
CREATE TRIGGER trg_message_defaults
    BEFORE INSERT ON chat_messages
    FOR EACH ROW EXECUTE FUNCTION set_message_defaults();

-- 索引
CREATE INDEX IF NOT EXISTS idx_cm_conversation ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cm_created      ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_cm_type         ON chat_messages(memory_type);
CREATE INDEX IF NOT EXISTS idx_cm_related_date ON chat_messages(related_date);
CREATE INDEX IF NOT EXISTS idx_cm_source       ON chat_messages(source);
CREATE INDEX IF NOT EXISTS idx_cm_heat         ON chat_messages(heat DESC);
CREATE INDEX IF NOT EXISTS idx_cm_tags         ON chat_messages USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_cm_emotion      ON chat_messages USING GIN(emotion);

-- ─────────────────────────────────────────────
-- 摘要表：橘瓣原生 DiarySummaryService 的落点（结构按原生约定，勿改列名）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_summaries (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assistant_id TEXT        NOT NULL,
    content      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    embedding    TEXT                          -- "[0.1,0.2,...]" 字符串，原生客户端算余弦
);

CREATE INDEX IF NOT EXISTS idx_ms_assistant ON memory_summaries(assistant_id);
CREATE INDEX IF NOT EXISTS idx_ms_created   ON memory_summaries(created_at);

-- ─────────────────────────────────────────────
-- 元数据表：RPC 内部用（幂等控制等），anon 无法直接访问
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rism_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ─────────────────────────────────────────────
-- RPC 函数（SECURITY DEFINER：函数内部以 owner 权限执行，
-- 这是 anon 唯一的"修改"通道，且只能做函数允许的事）
-- ─────────────────────────────────────────────

-- 每日热力衰减：heat -0.3，下限 1（所有记忆都保留）。同一天重复调用自动跳过
CREATE OR REPLACE FUNCTION decay_memory_heat() RETURNS JSON AS $$
DECLARE
    last_run TEXT;
    affected INT;
BEGIN
    SELECT value INTO last_run FROM rism_meta WHERE key = 'last_decay_date';
    IF last_run IS NOT DISTINCT FROM CURRENT_DATE::TEXT THEN
        RETURN json_build_object('skipped', true, 'date', last_run);
    END IF;
    UPDATE chat_messages SET heat = GREATEST(heat - 0.3, 1) WHERE heat > 1;
    GET DIAGNOSTICS affected = ROW_COUNT;
    INSERT INTO rism_meta(key, value) VALUES ('last_decay_date', CURRENT_DATE::TEXT)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    RETURN json_build_object('skipped', false, 'affected', affected);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 记忆升温：被想起 = 变暖（检索命中 +1，主动引用 +2），上限 10
CREATE OR REPLACE FUNCTION boost_memory_heat(mem_id BIGINT, amount REAL DEFAULT 1)
RETURNS JSON AS $$
DECLARE
    new_heat REAL;
BEGIN
    UPDATE chat_messages
       SET heat = LEAST(heat + GREATEST(amount, 0), 10)
     WHERE id = mem_id
    RETURNING heat INTO new_heat;
    IF new_heat IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'memory not found');
    END IF;
    RETURN json_build_object('success', true, 'id', mem_id, 'heat', new_heat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 完成待办：只允许改 memory_type='todo' 的行，往 metadata 里写完成标记
CREATE OR REPLACE FUNCTION complete_todo(todo_id BIGINT) RETURNS JSON AS $$
DECLARE
    updated_id BIGINT;
BEGIN
    UPDATE chat_messages
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('status', 'done', 'completed_at', NOW())
     WHERE id = todo_id AND memory_type = 'todo'
    RETURNING id INTO updated_id;
    IF updated_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'todo not found');
    END IF;
    RETURN json_build_object('success', true, 'id', updated_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- RLS：anon 只进不改不删；rism_meta 完全锁死
-- ─────────────────────────────────────────────
ALTER TABLE chat_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rism_meta        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon insert" ON chat_messages;
DROP POLICY IF EXISTS "anon select" ON chat_messages;
CREATE POLICY "anon insert" ON chat_messages    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon select" ON chat_messages    FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon insert" ON memory_summaries;
DROP POLICY IF EXISTS "anon select" ON memory_summaries;
CREATE POLICY "anon insert" ON memory_summaries FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon select" ON memory_summaries FOR SELECT TO anon USING (true);
-- rism_meta 不建任何策略 = anon 无法读写，只有 SECURITY DEFINER 函数内部能动

GRANT EXECUTE ON FUNCTION decay_memory_heat()            TO anon;
GRANT EXECUTE ON FUNCTION boost_memory_heat(BIGINT, REAL) TO anon;
GRANT EXECUTE ON FUNCTION complete_todo(BIGINT)           TO anon;

-- ─────────────────────────────────────────────
-- 可选加固（默认注释，需要时手动执行）
-- ─────────────────────────────────────────────
-- ① pg_cron 兜底衰减（插件 daily_cron 已是主路径，这是双保险）：
--    Dashboard → Database → Extensions 启用 pg_cron 后执行：
-- SELECT cron.schedule('memory-heat-decay', '0 4 * * *', $$SELECT decay_memory_heat()$$);
--
-- ② ilike 搜索加速（记忆超过几万条再考虑）：
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX idx_cm_content_trgm ON chat_messages USING GIN(content gin_trgm_ops);
