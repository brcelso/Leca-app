import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Check, Trash2, Edit2, Calendar, Target, TrendingUp, History, X, Save, RefreshCw, Settings, ShieldCheck, AlertCircle, LayoutGrid, List, Info } from 'lucide-react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db, migrateFromLocalStorage, gun, getSyncNode, syncTaskToGun, syncAllToGun } from './db';

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

function App() {
  // DB Queries
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const history = useLiveQuery(() => db.history.orderBy('weekStart').reverse().toArray(), []) || [];

  const [showModal, setShowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskName, setTaskName] = useState('');
  const [taskFreq, setTaskFreq] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [syncPhrase, setSyncPhrase] = useState(localStorage.getItem('leca_sync_phrase') || '');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, active, error
  const [viewMode, setViewMode] = useState(window.innerWidth < 768 ? 'cards' : 'table');

  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 0 });
  const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');

  // Handle Resize for View Mode
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setViewMode('cards');
      else setViewMode('table');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initial Migration & Sync Listeners
  useEffect(() => {
    const init = async () => {
      await migrateFromLocalStorage();

      const lastWeekStart = localStorage.getItem('leca_last_week_start_final');
      if (lastWeekStart && lastWeekStart !== currentWeekStartStr) {
        const allTasks = await db.tasks.toArray();
        if (allTasks.length > 0) {
          const score = calculateScore(allTasks, lastWeekStart);
          await db.history.add({ weekStart: lastWeekStart, score });
          for (const task of allTasks) {
            await db.tasks.update(task.id, { completions: [] });
            if (syncPhrase && syncPhrase.length >= 4) syncTaskToGun({ ...task, completions: [] }, syncPhrase);
          }
        }
      }
      localStorage.setItem('leca_last_week_start_final', currentWeekStartStr);
    };
    init();
  }, [currentWeekStartStr, syncPhrase]);

  // Gun.js Subscription & Peer Management
  useEffect(() => {
    if (!syncPhrase || syncPhrase.trim().length < 4) {
      setSyncStatus('idle');
      return;
    }

    const node = getSyncNode(syncPhrase);
    if (!node) return;

    setSyncStatus('active');
    console.log(`[Leca Sync] Starting listeners for phrase: ${syncPhrase}`);

    // Explicitly push current state once to ensure new peers see our data
    syncAllToGun(syncPhrase);

    const tasksNode = node.get('tasks');

    // Process incoming data
    const sub = tasksNode.map().on(async (data, name) => {
      if (!data) return;

      setIsSyncing(true);
      const localTask = await db.tasks.where('name').equals(name).first();
      // Gun might send partial data if we are not careful, but here it should be the whole object
      const remoteCompletions = JSON.parse(data.completions || '[]');

      if (!localTask) {
        console.log(`[Leca Sync] New task discovered: ${name}`);
        await db.tasks.add({
          name: data.name,
          targetFreq: data.targetFreq,
          completions: remoteCompletions,
          createdAt: data.createdAt || new Date().toISOString()
        });
      } else {
        const localCompletions = localTask.completions || [];
        // Merge strategy: Unique union of both sets
        const combined = Array.from(new Set([...localCompletions, ...remoteCompletions]));

        const hasNewData = combined.length > localCompletions.length || data.targetFreq !== localTask.targetFreq;

        if (hasNewData) {
          console.log(`[Leca Sync] Updating local task with remote data: ${name}`);
          await db.tasks.update(localTask.id, {
            targetFreq: data.targetFreq,
            completions: combined
          });

          // If our local merged version is actually newer/more complete than remote, push it back
          if (combined.length > remoteCompletions.length) {
            console.log(`[Leca Sync] Reflecting merged data back to node: ${name}`);
            syncTaskToGun({ ...localTask, completions: combined, targetFreq: data.targetFreq }, syncPhrase);
          }
        }
      }
      setTimeout(() => setIsSyncing(false), 800);
    });

    return () => {
      console.log("[Leca Sync] Stopping listeners");
      tasksNode.off();
    };
  }, [syncPhrase]);

  const saveSyncPhrase = (phrase) => {
    const trimmed = phrase.trim().toLowerCase();
    if (trimmed === syncPhrase) return;

    setSyncPhrase(trimmed);
    localStorage.setItem('leca_sync_phrase', trimmed);
    if (trimmed.length >= 4) {
      setSyncStatus('active');
      // Delay push slightly to ensure node is ready
      setTimeout(() => syncAllToGun(trimmed), 500);
    } else {
      setSyncStatus('idle');
    }
  };

  const manualSync = () => {
    if (syncPhrase && syncPhrase.length >= 4) {
      setIsSyncing(true);
      syncAllToGun(syncPhrase);
      setTimeout(() => setIsSyncing(false), 2000);
    } else {
      setShowSettings(true);
    }
  };

  const calculateScore = (taskList, weekBaseStr) => {
    if (taskList.length === 0) return 0;
    const weekBase = parseISO(weekBaseStr);
    const scores = taskList.map(t => {
      const weekDates = DAYS_OF_WEEK.map(d => format(addDays(weekBase, d), 'yyyy-MM-dd'));
      const completionsThisWeek = (t.completions || []).filter(d => weekDates.includes(d)).length;
      return Math.min(Math.round((completionsThisWeek / t.targetFreq) * 100), 100);
    });
    return Math.round(scores.reduce((a, b) => a + b, 0) / taskList.length);
  };

  const calculateDailyCompletion = (date) => {
    if (tasks.length === 0) return 0;
    const dateStr = format(date, 'yyyy-MM-dd');
    const completed = tasks.filter(t => (t.completions || []).includes(dateStr)).length;
    return Math.round((completed / tasks.length) * 100);
  };

  const calculateWeeklyProgress = (task) => {
    const weekDates = DAYS_OF_WEEK.map(d => format(addDays(currentWeekStart, d), 'yyyy-MM-dd'));
    const completionsThisWeek = (task.completions || []).filter(d => weekDates.includes(d)).length;
    return Math.min(Math.round((completionsThisWeek / task.targetFreq) * 100), 100);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!taskName.trim()) return;

    if (editingTask) {
      const updated = { name: taskName, targetFreq: parseInt(taskFreq) };
      await db.tasks.update(editingTask.id, updated);
      if (syncPhrase && syncPhrase.length >= 4) syncTaskToGun({ ...editingTask, ...updated }, syncPhrase);
    } else {
      const newTask = {
        name: taskName,
        targetFreq: parseInt(taskFreq),
        completions: [],
        createdAt: new Date().toISOString()
      };
      const id = await db.tasks.add(newTask);
      if (syncPhrase && syncPhrase.length >= 4) syncTaskToGun({ ...newTask, id }, syncPhrase);
    }
    closeModal();
  };

  const toggleDay = async (task, date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const completions = task.completions || [];
    const newCompletions = completions.includes(dateStr)
      ? completions.filter(d => d !== dateStr)
      : [...completions, dateStr];

    await db.tasks.update(task.id, { completions: newCompletions });
    if (syncPhrase && syncPhrase.length >= 4) syncTaskToGun({ ...task, completions: newCompletions }, syncPhrase);
  };

  const deleteTask = async (id) => {
    if (confirm('Deseja realmente excluir este hábito?')) {
      const task = await db.tasks.get(id);
      await db.tasks.delete(id);
      if (syncPhrase && syncPhrase.length >= 4 && task) {
        getSyncNode(syncPhrase).get('tasks').get(task.name).put(null);
      }
    }
  };

  const openModal = (task = null) => {
    if (task) {
      setEditingTask(task);
      setTaskName(task.name);
      setTaskFreq(task.targetFreq);
    } else {
      setEditingTask(null);
      setTaskName('');
      setTaskFreq(1);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  const totalScore = calculateScore(tasks, currentWeekStartStr);

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="fade-in">Leca</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Foco e Consistência</p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div
            className={`sync-status ${syncStatus} ${isSyncing ? 'syncing' : ''}`}
            onClick={manualSync}
            style={{ cursor: 'pointer' }}
            title={syncPhrase ? (isSyncing ? 'Sincronizando...' : `Conectado: ${syncPhrase}`) : 'Sem sincronização'}
          >
            <RefreshCw size={18} className={isSyncing ? 'spin' : ''} />
          </div>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="Sincronização">
            <Settings size={22} />
          </button>
          <button className="btn-icon hide-mobile" onClick={() => setViewMode(viewMode === 'table' ? 'cards' : 'table')} title="Mudar Visualização">
            {viewMode === 'table' ? <LayoutGrid size={22} /> : <List size={22} />}
          </button>
          <button className="btn-icon" onClick={() => setShowHistory(!showHistory)} title="Histórico">
            <History size={22} />
          </button>
          <button className="btn-primary" onClick={() => openModal()} style={{ marginLeft: '0.5rem' }}>
            <Plus size={20} /> <span className="hide-mobile">Novo</span>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in" style={{ maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Sincronização Cloud</h2>
              <button onClick={() => setShowSettings(false)} className="btn-icon-tiny"><X size={24} /></button>
            </div>

            <div className="info-box">
              <Info size={20} color="var(--primary)" />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                Use a mesma frase em outros dispositivos para manter seus hábitos sincronizados.
              </p>
            </div>

            <input
              type="text"
              placeholder="Sua frase secreta..."
              defaultValue={syncPhrase}
              onBlur={(e) => saveSyncPhrase(e.target.value)}
              className="sync-input"
            />
            {syncPhrase && (
              <div className={syncPhrase.length >= 4 ? "success-text" : "error-text"}>
                {syncPhrase.length >= 4 ? <ShieldCheck size={16} /> : <AlertCircle size={16} />}
                {syncPhrase.length >= 4 ? `Sincronização Ativa` : "Frase muito curta (mínimo 4)."}
              </div>
            )}

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1.5rem' }}>
              Dica: Após configurar o ID pela primeira vez, clique no ícone de setinhas no topo para garantir o envio inicial.
            </p>

            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowSettings(false)}>Fechar</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="glass-card fade-in" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', color: 'var(--primary)' }}>Histórico Semanal</h2>
          <div className="stats-grid">
            {history.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', gridColumn: '1/-1' }}>Nenhum histórico disponível ainda.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="glass-card" style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Semana {format(parseISO(h.weekStart), 'dd/MM')}</span>
                    <span style={{ color: 'var(--success)', fontWeight: 700 }}>{h.score}%</span>
                  </div>
                  <div className="progress-bar-container">
                    <div className="progress-bar" style={{ width: `${h.score}%` }}></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="glass-card stat-card fade-in">
          <div className="stat-label">Progresso Semanal</div>
          <div className="stat-value">{totalScore}%</div>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${totalScore}%` }}></div>
          </div>
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="stat-label">Cofrequência Hoje</div>
          <div className="stat-value">{calculateDailyCompletion(today)}%</div>
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="stat-label">Total de Hábitos</div>
          <div className="stat-value">{tasks.length}</div>
        </div>
      </div>

      <div className="glass-card fade-in" style={{ padding: viewMode === 'table' ? '0' : '1.5rem' }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            Nenhum hábito no momento. Clique em "Novo" para começar!
          </div>
        ) : viewMode === 'table' ? (
          <div className="task-table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingLeft: '1.5rem' }}>Hábito</th>
                  {DAYS_OF_WEEK.map(d => (
                    <th key={d}>{format(addDays(currentWeekStart, d), 'EEE', { locale: ptBR })}</th>
                  ))}
                  <th style={{ paddingRight: '1.5rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ paddingLeft: '1.5rem' }}>
                      <div className="task-name">{task.name}</div>
                      <div className="task-frequency">{task.targetFreq}x p/ semana</div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button onClick={() => openModal(task)} className="btn-icon-tiny" style={{ color: 'var(--text-muted)' }}><Edit2 size={13} /></button>
                        <button onClick={() => deleteTask(task.id)} className="btn-icon-tiny" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                    {DAYS_OF_WEEK.map(d => {
                      const dayDate = addDays(currentWeekStart, d);
                      const isDone = (task.completions || []).includes(format(dayDate, 'yyyy-MM-dd'));
                      return (
                        <td key={d}>
                          <div className={`checkbox-day ${isDone ? 'checked' : ''}`} onClick={() => toggleDay(task, dayDate)}>
                            {isDone && <Check size={16} color="white" />}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', paddingRight: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{calculateWeeklyProgress(task)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {tasks.map(task => (
              <div key={task.id} className="glass-card" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div>
                    <div className="task-name" style={{ fontSize: '1.1rem' }}>{task.name}</div>
                    <div className="task-frequency">Meta: {task.targetFreq}x</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => openModal(task)} className="btn-icon-tiny" style={{ color: 'var(--text-muted)' }}><Edit2 size={18} /></button>
                    <button onClick={() => deleteTask(task.id)} className="btn-icon-tiny" style={{ color: 'var(--danger)' }}><Trash2 size={18} /></button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem', marginBottom: '1rem' }}>
                  {DAYS_OF_WEEK.map(d => {
                    const dayDate = addDays(currentWeekStart, d);
                    const isDone = (task.completions || []).includes(format(dayDate, 'yyyy-MM-dd'));
                    return (
                      <div key={d} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                          {format(dayDate, 'EEEEE', { locale: ptBR })}
                        </div>
                        <div className={`checkbox-day ${isDone ? 'checked' : ''}`} style={{ width: '100%', height: '36px' }} onClick={() => toggleDay(task, dayDate)}>
                          {isDone && <Check size={18} color="white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="progress-bar-container" style={{ flex: 1, marginRight: '1rem', marginTop: 0 }}>
                    <div className="progress-bar" style={{ width: `${calculateWeeklyProgress(task)}%` }}></div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary)' }}>{calculateWeeklyProgress(task)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>{editingTask ? 'Editar' : 'Novo Hábito'}</h2>
              <button onClick={closeModal} className="btn-icon-tiny"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Nome do Hábito</label>
              <input type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)} autoFocus placeholder="Nome do hábito..." />
              <label>Frequência (vezes p/ semana)</label>
              <select value={taskFreq} onChange={(e) => setTaskFreq(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}x por semana</option>)}
              </select>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--border)', flex: 1 }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 2, justifyContent: 'center' }}>{editingTask ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
