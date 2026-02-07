import Dexie from 'dexie';
import Gun from 'gun';

// Gun.js Init - diversified relays
export const gun = Gun({
    peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://peer.wall.org/gun',
        'https://gundb-relays.herokuapp.com/gun',
        'https://gun-us-west.herokuapp.com/gun',
        'https://gun-eu-west.herokuapp.com/gun'
    ]
});

export const db = new Dexie('LecaDB');

// Version 2: Added 'uuid' to tasks for stable sync
db.version(2).stores({
    tasks: '++id, uuid, name, targetFreq, completions, createdAt',
    history: '++id, weekStart, score'
});

// Utility to generate UUID v4
export const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Helper to get the sync node based on a phrase
export const getSyncNode = (phrase) => {
    if (!phrase || phrase.trim().length < 4) return null;
    const cleanPhrase = phrase.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    // Fresh namespace for the new UUID-based architecture
    return gun.get('leca_v4_core').get(cleanPhrase);
};

// Sync local task to Gun using UUID as the key
export const syncTaskToGun = (task, phrase) => {
    const node = getSyncNode(phrase);
    if (!node || !task.uuid) {
        console.warn('[Sync] Missing phrase or UUID for task:', task.name);
        return;
    }

    console.log(`[Sync] Pushing task to cloud: ${task.name} (${task.uuid})`);
    node.get('tasks').get(task.uuid).put({
        uuid: task.uuid,
        name: task.name,
        targetFreq: task.targetFreq,
        completions: JSON.stringify(task.completions || []),
        createdAt: task.createdAt,
        updatedAt: Date.now()
    });
};

// Sync everything from Local DB to Gun
export const syncAllToGun = async (phrase) => {
    if (!phrase || phrase.length < 4) return;
    const allTasks = await db.tasks.toArray();
    console.log(`[Sync] Triggering full push of ${allTasks.length} tasks...`);
    allTasks.forEach(task => {
        if (!task.uuid) {
            // Assign UUID if missing for legacy data
            const uuid = generateUUID();
            db.tasks.update(task.id, { uuid });
            syncTaskToGun({ ...task, uuid }, phrase);
        } else {
            syncTaskToGun(task, phrase);
        }
    });
};

export const migrateFromLocalStorage = async () => {
    const tasks = JSON.parse(localStorage.getItem('leca_tasks') || '[]');
    const history = JSON.parse(localStorage.getItem('leca_history') || '[]');

    if (tasks.length > 0 || history.length > 0) {
        console.log('[Migration] Moving data to IndexedDB...');
        for (const task of tasks) {
            const exists = await db.tasks.where('name').equals(task.name).first();
            if (!exists) {
                await db.tasks.add({
                    uuid: generateUUID(),
                    name: task.name,
                    targetFreq: task.targetFreq,
                    completions: task.completions || [],
                    createdAt: task.createdAt || new Date().toISOString()
                });
            }
        }
        for (const h of history) {
            await db.history.add(h);
        }
        localStorage.removeItem('leca_tasks');
        localStorage.removeItem('leca_history');
        localStorage.removeItem('leca_last_week_start');
    }
};
