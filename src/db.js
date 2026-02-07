import Dexie from 'dexie';
import { createClient } from '@supabase/supabase-js';

// Supabase Configuration from Environment
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create Supabase client (only if credentials exist)
export const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('YOUR_'))
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// Local DB (Dexie) - cache for offline usage and performance
export const db = new Dexie('LecaDB_v5');
db.version(1).stores({
    tasks: '++id, uuid, name, targetFreq, completions, createdAt, updatedAt',
    history: '++id, weekStart, score'
});

// Helper to generate UUID
export const generateUUID = () => {
    return crypto.randomUUID();
};

// Sync single task to Supabase
export const syncTaskToCloud = async (task, phrase) => {
    if (!supabase || !phrase || phrase.length < 4) return;

    try {
        const { error } = await supabase
            .from('leca_tasks')
            .upsert({
                uuid: task.uuid,
                sync_id: phrase.trim().toLowerCase(),
                name: task.name,
                target_freq: task.targetFreq,
                completions: task.completions || [],
                updated_at: new Date().toISOString()
            }, { onConflict: 'uuid' });

        if (error) console.error('[Supabase Sync Error]', error.message);
    } catch (err) {
        console.error('[Supabase Catastrophic Failure]', err);
    }
};

// Push all local tasks to Supabase
export const syncAllToCloud = async (phrase) => {
    if (!supabase || !phrase || phrase.length < 4) return;
    const allTasks = await db.tasks.toArray();
    for (const task of allTasks) {
        await syncTaskToCloud(task, phrase);
    }
};

// Initial Migration helper
export const migrateData = async () => {
    // Migration from v4 (if exists)
    const oldDb = new Dexie('LecaDB');
    try {
        const exists = await Dexie.exists('LecaDB');
        if (exists) {
            await oldDb.open();
            const oldTasks = await oldDb.table('tasks').toArray();
            for (const t of oldTasks) {
                const alreadyMigrated = await db.tasks.where('uuid').equals(t.uuid).first();
                if (!alreadyMigrated) {
                    await db.tasks.add({
                        ...t,
                        updatedAt: t.updatedAt || new Date().toISOString()
                    });
                }
            }
            console.log('[Migration] Data from v4 moved to v5');
        }
    } catch (e) {
        console.warn('[Migration] No v4 data found or error:', e);
    }
};
