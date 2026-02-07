import Dexie from 'dexie';
import Gun from 'gun';

// Gun.js Init - using public relays
export const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);

export const db = new Dexie('LecaDB');

db.version(1).stores({
    tasks: '++id, name, targetFreq, createdAt',
    history: '++id, weekStart, score'
});

// Helper to get the sync node based on a phrase
export const getSyncNode = (phrase) => {
    if (!phrase) return null;
    return gun.get('leca_app_sync').get(phrase);
};

// Sync local task to Gun
export const syncTaskToGun = async (task, phrase) => {
    const node = getSyncNode(phrase);
    if (!node) return;

    node.get('tasks').get(task.name).put({
        name: task.name,
        targetFreq: task.targetFreq,
        completions: JSON.stringify(task.completions || []),
        createdAt: task.createdAt,
        updatedAt: Date.now()
    });
};

// Sync everything to Gun
export const syncAllToGun = async (phrase) => {
    const allTasks = await db.tasks.toArray();
    for (const task of allTasks) {
        await syncTaskToGun(task, phrase);
    }
};

// Helper for initial migration
export const migrateFromLocalStorage = async () => {
    const tasks = JSON.parse(localStorage.getItem('leca_tasks') || '[]');
    const history = JSON.parse(localStorage.getItem('leca_history') || '[]');

    if (tasks.length > 0 || history.length > 0) {
        console.log('Migrating data from LocalStorage to IndexedDB...');

        for (const task of tasks) {
            await db.tasks.add({
                name: task.name,
                targetFreq: task.targetFreq,
                completions: task.completions,
                createdAt: task.createdAt
            });
        }

        for (const h of history) {
            await db.history.add(h);
        }

        localStorage.removeItem('leca_tasks');
        localStorage.removeItem('leca_history');
        localStorage.removeItem('leca_last_week_start');
        console.log('Migration complete!');
    }
};
