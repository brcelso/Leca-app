import Dexie from 'dexie';

// Cloudflare Worker API URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787/api';

// Local DB (Dexie) - cache for offline usage and performance
export const db = new Dexie('LecaDB_v6'); // Incremented version for v6 (Enterprise)
db.version(1).stores({
    tasks: '++id, uuid, name, targetFreq, completions, createdAt, updatedAt',
    history: '++id, weekStart, score'
});

// Helper to generate UUID
export const generateUUID = () => {
    return crypto.randomUUID();
};

/**
 * Sync single task to Cloudflare Worker
 * @param {Object} task 
 * @param {String} userEmail 
 * @param {String} token (Optional for now)
 */
export const syncTaskToCloud = async (task, userEmail) => {
    if (!userEmail) return;

    try {
        const response = await fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User-Email': userEmail, // Dev-mode identification
                'Authorization': `Bearer local-dev-token`
            },
            body: JSON.stringify({
                uuid: task.uuid,
                name: task.name,
                targetFreq: task.targetFreq,
                completions: task.completions || [],
                updatedAt: new Date().toISOString()
            })
        });

        if (!response.ok) {
            console.error('[Worker Sync Error]', await response.text());
        }
    } catch (err) {
        console.error('[Worker Connection Failure]', err);
    }
};

/**
 * Fetch all tasks from Cloudflare
 */
export const fetchAllTasks = async (userEmail) => {
    if (!userEmail) return [];
    try {
        const response = await fetch(`${API_URL}/tasks`, {
            headers: {
                'X-User-Email': userEmail,
                'Authorization': `Bearer local-dev-token`
            }
        });
        if (response.ok) return await response.json();
        return [];
    } catch (err) {
        console.error('[Worker Fetch Failure]', err);
        return [];
    }
};

/**
 * Push all local tasks to Cloudflare
 */
export const syncAllToCloud = async (userEmail) => {
    if (!userEmail) return;
    const allTasks = await db.tasks.toArray();
    for (const task of allTasks) {
        await syncTaskToCloud(task, userEmail);
    }
};

/**
 * Migration helper from LecaDB_v5 (Supabase version)
 */
export const migrateData = async () => {
    try {
        const v5Exists = await Dexie.exists('LecaDB_v5');
        if (v5Exists) {
            const v5Db = new Dexie('LecaDB_v5');
            await v5Db.open();
            const oldTasks = await v5Db.table('tasks').toArray();
            for (const t of oldTasks) {
                const exists = await db.tasks.where('uuid').equals(t.uuid).first();
                if (!exists) {
                    await db.tasks.add({
                        ...t,
                        updatedAt: t.updatedAt || new Date().toISOString()
                    });
                }
            }
            console.log('[Migration] Data moved from v5 to v6');
        }
    } catch (e) {
        console.warn('[Migration] Error or no previous data:', e);
    }
};
