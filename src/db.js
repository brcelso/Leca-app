import Dexie from 'dexie';

// Cloudflare Worker API URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787/api';

// Local DB (Dexie) - cache for offline usage and performance
export const db = new Dexie('LecaDB_v7'); // Incremented version for v7 (User isolation)
db.version(1).stores({
    tasks: '++id, uuid, userEmail, name, targetFreq, completions, createdAt, updatedAt',
    history: '++id, weekStart, score'
});

// Helper to generate UUID (Polyfill for older iOS/Safari)
export const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/**
 * Sync single task to Cloudflare Worker
 * @param {Object} task 
 * @param {String} userEmail 
 * @param {String} token Google ID Token
 */
export const syncTaskToCloud = async (task, userEmail, token) => {
    if (!userEmail || !token) return;
    const email = userEmail.toLowerCase();

    try {
        const response = await fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User-Email': email,
                'Authorization': `Bearer ${token}`
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
export const fetchAllTasks = async (userEmail, token) => {
    if (!userEmail || !token) return [];
    const email = userEmail.toLowerCase();
    try {
        const response = await fetch(`${API_URL}/tasks`, {
            headers: {
                'X-User-Email': email,
                'Authorization': `Bearer ${token}`
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
export const syncAllToCloud = async (userEmail, token) => {
    if (!userEmail || !token) return;
    const email = userEmail.toLowerCase();
    const allTasks = await db.tasks.toArray();
    for (const task of allTasks) {
        await syncTaskToCloud(task, email, token);
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
