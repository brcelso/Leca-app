import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Check, Trash2, Edit2, Calendar, Target, TrendingUp, History, X, Save, RefreshCw, Settings, ShieldCheck, AlertCircle } from 'lucide-react';
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

  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 0 });
  const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');

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

  // Gun.js Subscription
  useEffect(() => {
    if (!syncPhrase || syncPhrase.trim().length < 4) {
      setSyncStatus('idle');
      return;
    }

    const node = getSyncNode(syncPhrase);
    if (!node) return;

    setSyncStatus('active');
    console.log('Gun.js: Listening on phrase:', syncPhrase);

    const tasksNode = node.get('tasks');

    // Subscribe to changes in tasks
    const sub = tasksNode.map().on(async (data, name) => {
      if (!data) return; // Task deleted

      setIsSyncing(true);
      const localTask = await db.tasks.where('name').equals(name).first();
      const remoteCompletions = JSON.parse(data.completions || '[]');

      if (!localTask) {
        console.log('Gun.js: Adding missing task from cloud:', name);
        await db.tasks.add({
          name: data.name,
          targetFreq: data.targetFreq,
          completions: remoteCompletions,
          createdAt: data.createdAt
        });
      } else {
        // MERGE: Set logic for completions
        const localCompletions = localTask.completions || [];
        const combined = Array.from(new Set([...localCompletions, ...remoteCompletions]));

        // Update local if remote has more info or different frequency
        if (combined.length > localCompletions.length || data.targetFreq !== localTask.targetFreq) {
          console.log('Gun.js: Updating task with data from cloud:', name);
          await db.tasks.update(localTask.id, {
            targetFreq: data.targetFreq,
            completions: combined
          });

          // If we also added local info to the mix, push it back to the cloud
          if (combined.length > remoteCompletions.length) {
            syncTaskToGun({ ...localTask, completions: combined, targetFreq: data.targetFreq }, syncPhrase);
          }
        }
      }

      setTimeout(() => setIsSyncing(false), 500);
    });

    return () => {
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
      syncAllToGun(trimmed);
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
    if (confirm('Tem certeza que deseja excluir esta tarefa?')) {
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
          <h1 className="fade-in">Acompanhamento Pessoal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Mantenha sua frequência e alcance seus objetivos</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div
            className={`sync-status ${syncStatus} ${isSyncing ? 'syncing' : ''}`}
            onClick={manualSync}
            style={{ cursor: 'pointer' }}
            title={syncPhrase ? (isSyncing ? 'Sincronizando...' : `Conectado: ${syncPhrase}\nClique para forçar sync`) : 'Sincronização desativada'}
          >
            <RefreshCw size={18} className={isSyncing ? 'spin' : ''} />
          </div>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="Configurações de Sincronização">
            <Settings size={22} />
          </button>
          <button className="btn-icon" onClick={() => setShowHistory(!showHistory)} title={showHistory ? 'Ocultar Histórico' : 'Ver Histórico'}>
            <History size={22} />
          </button>
          <button className="btn-primary fade-in" onClick={() => openModal()}>
            <Plus size={20} /> <span className="hide-mobile">Nova Tarefa</span>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in" style={{ maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CloudSync size={24} color="var(--primary)" />
                <h2 style={{ margin: 0 }}>Sincronização</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="btn-icon-small"><X size={20} /></button>
            </div>

            <div className="info-box">
              <ShieldCheck size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <p style={{ fontSize: '0.85rem' }}>
                Seus dados são compartilhados apenas com quem possuir sua frase. Use algo único e pessoal.
              </p>
            </div>

            <label style={{ marginTop: '1rem' }}>Sua Frase de Sincronização</label>
            <input
              type="text"
              placeholder="Ex: meu-diario-habit-2026"
              defaultValue={syncPhrase}
              onBlur={(e) => saveSyncPhrase(e.target.value)}
              className="sync-input"
            />
            {syncPhrase && syncPhrase.length < 4 ? (
              <div className="error-text">
                <AlertCircle size={14} /> Mínimo de 4 caracteres para ativar.
              </div>
            ) : syncPhrase && (
              <div className="success-text">
                <ShieldCheck size={14} /> Sincronização Ativa para: <strong>{syncPhrase}</strong>
              </div>
            )}

            <button className="btn-primary" style={{ width: '100%', marginTop: '1rem', justifyContent: 'center' }} onClick={() => setShowSettings(false)}>
              Salvar e Fechar
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="glass-card fade-in" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', color: 'var(--primary)' }}>Histórico de Semanas</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {history.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>Ainda não há semanas arquivadas.</p>
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
          <TrendingUp size={24} style={{ color: 'var(--success)', marginTop: '0.5rem' }} />
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="stat-label">Total de Hábitos</div>
          <div className="stat-value">{tasks.length}</div>
          <Target size={24} style={{ color: 'var(--primary)', marginTop: '0.5rem' }} />
        </div>
      </div>

      <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
        <div className="task-table-container">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Tarefa / Hábito</th>
                {DAYS_OF_WEEK.map(d => {
                  const day = addDays(currentWeekStart, d);
                  return (
                    <th key={d}>
                      {format(day, 'EEE', { locale: ptBR })}
                      <br />
                      <span style={{ fontSize: '0.65rem' }}>{format(day, 'dd/MM')}</span>
                    </th>
                  );
                })}
                <th>Semana</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    Nenhuma tarefa cadastrada. Comece adicionando uma!
                  </td>
                </tr>
              ) : (
                tasks.map(task => (
                  <tr key={task.id}>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="task-name">{task.name}</span>
                          <span className="task-frequency">Meta: {task.targetFreq}x / semana</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => openModal(task)} style={{ background: 'transparent', color: 'var(--text-muted)', opacity: 0.6 }} className="btn-icon-tiny"><Edit2 size={16} /></button>
                          <button onClick={() => deleteTask(task.id)} style={{ background: 'transparent', color: 'var(--danger)', opacity: 0.6 }} className="btn-icon-tiny"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </td>
                    {DAYS_OF_WEEK.map(d => {
                      const dayDate = addDays(currentWeekStart, d);
                      const isDone = (task.completions || []).includes(format(dayDate, 'yyyy-MM-dd'));
                      return (
                        <td key={d}>
                          <div className={`checkbox-day ${isDone ? 'checked' : ''}`} onClick={() => toggleDay(task, dayDate)}>
                            {isDone && <Check size={14} color="white" />}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{calculateWeeklyProgress(task)}%</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>{editingTask ? 'Editar Tarefa' : 'Nova Atividade'}</h2>
              <button onClick={closeModal} className="btn-icon-small"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Nome da Tarefa</label>
              <input type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)} autoFocus />
              <label>Frequência Semanal</label>
              <select value={taskFreq} onChange={(e) => setTaskFreq(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}x por semana</option>)}
              </select>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--border)' }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{editingTask ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
