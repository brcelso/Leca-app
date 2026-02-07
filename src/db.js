import Dexie from 'dexie';

export const db = new Dexie('LecaDB');

db.version(1).stores({
    tasks: '++id, name, targetFreq, createdAt',
    history: '++id, weekStart, score'
});

// Helper for initial migration
export const migrateFromLocalStorage = async () => {
    const tasks = JSON.parse(localStorage.getItem('leca_tasks') || '[]');
    const history = JSON.parse(localStorage.getItem('leca_history') || '[]');

    if (tasks.length > 0 || history.length > 0) {
        console.log('Migrating data from LocalStorage to IndexedDB...');

        // Add tasks
        for (const task of tasks) {
            await db.tasks.add({
                name: task.name,
                targetFreq: task.targetFreq,
                completions: task.completions,
                createdAt: task.createdAt
            });
        }

        // Add history
        for (const h of history) {
            await db.history.add(h);
        }

        // Clear old storage
        localStorage.removeItem('leca_tasks');
        localStorage.removeItem('leca_history');
        localStorage.removeItem('leca_last_week_start');
        console.log('Migration complete!');
    }
};
