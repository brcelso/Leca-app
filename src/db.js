import Dexie from 'dexie';
import Gun from 'gun';

// Gun.js Init - using a more diverse and updated set of public relays
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

db.version(1).stores({
    tasks: '++id, name, targetFreq, completions, createdAt',
    history: '++id, weekStart, score'
});

// Helper to get the sync node based on a phrase
export const getSyncNode = (phrase) => {
    if (!phrase || phrase.trim().length < 4) return null;
    // We use a new namespace to ensure we start with clean data
    const cleanPhrase = phrase.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    return gun.get('leca_v3_final').get(cleanPhrase);
};

// Sync local task to Gun
export const syncTaskToGun = (task, phrase) => {
    const node = getSyncNode(phrase);
    if (!node) return;

    console.log(`Syncing task to cloud: ${task.name}`);
    node.get('tasks').get(task.name).put({
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
    console.log(`Pushing ${allTasks.length} tasks to cloud...`);
    allTasks.forEach(task => syncTaskToGun(task, phrase));
};

// Helper for initial migration from older LocalStorage versions
export const migrateFromLocalStorage = async () => {
    const tasks = JSON.parse(localStorage.getItem('leca_tasks') || '[]');
    const history = JSON.parse(localStorage.getItem('leca_history') || '[]');

    if (tasks.length > 0 || history.length > 0) {
        console.log('Migrating data from LocalStorage to IndexedDB...');
        for (const task of tasks) {
            const exists = await db.tasks.where('name').equals(task.name).first();
            if (!exists) {
                await db.tasks.add({
                    name: task.name,
                    targetFreq: task.targetFreq,
                    completions: task.completions,
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
