import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Check, Trash2, Edit2, Calendar, Target, TrendingUp, History, X, Save, RefreshCw, Settings, ShieldCheck, AlertCircle, LayoutGrid, List, Info, Database, Cloud, CloudOff } from 'lucide-react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db, migrateData, supabase, syncTaskToCloud, syncAllToCloud, generateUUID } from './db';

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
  const [viewMode, setViewMode] = useState(window.innerWidth < 768 ? 'cards' : 'table');

  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 0 });
  const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');

  const hasCredentials = !!supabase;

  // Handle Resize for View Mode
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setViewMode('cards');
      else setViewMode('table');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initial Setup
  useEffect(() => {
    const init = async () => {
      await migrateData();

      const lastWeekStart = localStorage.getItem('leca_last_week_start_v5');
      if (lastWeekStart && lastWeekStart !== currentWeekStartStr) {
        const allTasks = await db.tasks.toArray();
        if (allTasks.length > 0) {
          const score = calculateScore(allTasks, lastWeekStart);
          await db.history.add({ weekStart: lastWeekStart, score });
          for (const task of allTasks) {
            const updated = { completions: [], updatedAt: new Date().toISOString() };
            await db.tasks.update(task.id, updated);
            if (syncPhrase && syncPhrase.length >= 4) syncTaskToCloud({ ...task, ...updated }, syncPhrase);
          }
        }
      }
      localStorage.setItem('leca_last_week_start_v5', currentWeekStartStr);

      if (syncPhrase && syncPhrase.length >= 4) {
        syncAllToCloud(syncPhrase);
      }
    };
    init();
  }, [currentWeekStartStr, syncPhrase]);

  // Supabase Subscriptions
  useEffect(() => {
    if (!supabase || !syncPhrase || syncPhrase.trim().length < 4) return;

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leca_tasks',
          filter: `sync_id=eq.${syncPhrase.trim().toLowerCase()}`
        },
        async (payload) => {
          setIsSyncing(true);
          const remoteTask = payload.new;
          const remoteUUID = remoteTask.uuid;

          const localTask = await db.tasks.where('uuid').equals(remoteUUID).first();

          if (payload.eventType === 'DELETE' || !remoteTask) {
            // Deletion logic (if we wanted to sync deletes)
            return;
          }

          if (!localTask) {
            console.log('[Sync] Adding remote task');
            await db.tasks.add({
              uuid: remoteUUID,
              name: remoteTask.name,
              targetFreq: remoteTask.target_freq,
              completions: remoteTask.completions || [],
              createdAt: remoteTask.created_at || new Date().toISOString(),
              updatedAt: remoteTask.updated_at
            });
          } else {
            // Conflict resolution: Merge and compare timestamps
            const localCompletions = localTask.completions || [];
            const remoteCompletions = remoteTask.completions || [];
            const combined = Array.from(new Set([...localCompletions, ...remoteCompletions]));

            const remoteUpdated = new Date(remoteTask.updated_at).getTime();
            const localUpdated = new Date(localTask.updatedAt || localTask.createdAt).getTime();

            if (remoteUpdated > localUpdated || combined.length > localCompletions.length) {
              console.log('[Sync] Updating local task from cloud');
              await db.tasks.update(localTask.id, {
                name: remoteTask.name,
                targetFreq: remoteTask.target_freq,
                completions: combined,
                updatedAt: remoteTask.updated_at
              });
            }
          }
          setTimeout(() => setIsSyncing(false), 500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncPhrase]);

  // Polling fallback (since Realtime needs RLS to be configured properly)
  useEffect(() => {
    if (!supabase || !syncPhrase || syncPhrase.trim().length < 4) return;

    const poll = async () => {
      const { data, error } = await supabase
        .from('leca_tasks')
        .select('*')
        .eq('sync_id', syncPhrase.trim().toLowerCase());

      if (data && !error) {
        for (const remoteTask of data) {
          const localTask = await db.tasks.where('uuid').equals(remoteTask.uuid).first();
          if (!localTask) {
            await db.tasks.add({
              uuid: remoteTask.uuid,
              name: remoteTask.name,
              targetFreq: remoteTask.target_freq,
              completions: remoteTask.completions || [],
              createdAt: remoteTask.created_at,
              updatedAt: remoteTask.updated_at
            });
          } else {
            const localUpdated = new Date(localTask.updatedAt || localTask.createdAt).getTime();
            const remoteUpdated = new Date(remoteTask.updated_at).getTime();
            const localCompletions = localTask.completions || [];
            const remoteCompletions = remoteTask.completions || [];
            const combined = Array.from(new Set([...localCompletions, ...remoteCompletions]));

            if (remoteUpdated > localUpdated || combined.length > localCompletions.length) {
              await db.tasks.update(localTask.id, {
                name: remoteTask.name,
                targetFreq: remoteTask.target_freq,
                completions: combined,
                updatedAt: remoteTask.updated_at
              });
            }
          }
        }
      }
    };

    const interval = setInterval(poll, 15000); // Polling every 15s for extra safety
    poll(); // Initial run
    return () => clearInterval(interval);
  }, [syncPhrase]);

  const saveSyncPhrase = (phrase) => {
    const trimmed = phrase.trim().toLowerCase();
    if (trimmed === syncPhrase) return;
    setSyncPhrase(trimmed);
    localStorage.setItem('leca_sync_phrase', trimmed);
    if (trimmed.length >= 4) {
      syncAllToCloud(trimmed);
    }
  };

  const manualSync = () => {
    if (!hasCredentials) {
      setShowSettings(true);
      return;
    }
    if (syncPhrase && syncPhrase.length >= 4) {
      setIsSyncing(true);
      syncAllToCloud(syncPhrase);
      setTimeout(() => setIsSyncing(false), 2000);
    } else setShowSettings(true);
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
      const updated = {
        name: taskName,
        targetFreq: parseInt(taskFreq),
        updatedAt: new Date().toISOString()
      };
      await db.tasks.update(editingTask.id, updated);
      if (syncPhrase && syncPhrase.length >= 4) syncTaskToCloud({ ...editingTask, ...updated }, syncPhrase);
    } else {
      const newTask = {
        uuid: generateUUID(),
        name: taskName,
        targetFreq: parseInt(taskFreq),
        completions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const id = await db.tasks.add(newTask);
      if (syncPhrase && syncPhrase.length >= 4) syncTaskToCloud({ ...newTask, id }, syncPhrase);
    }
    closeModal();
  };

  const toggleDay = async (task, date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const completions = task.completions || [];
    const newCompletions = completions.includes(dateStr)
      ? completions.filter(d => d !== dateStr)
      : [...completions, dateStr];

    const updated = {
      completions: newCompletions,
      updatedAt: new Date().toISOString()
    };
    await db.tasks.update(task.id, updated);
    if (syncPhrase && syncPhrase.length >= 4) syncTaskToCloud({ ...task, ...updated }, syncPhrase);
  };

  const deleteTask = async (id) => {
    if (confirm('Excluir este hábito?')) {
      const task = await db.tasks.get(id);
      await db.tasks.delete(id);
      if (supabase && syncPhrase && syncPhrase.length >= 4 && task) {
        await supabase.from('leca_tasks').delete().eq('uuid', task.uuid);
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
      {!hasCredentials && (
        <div className="alert-banner">
          <AlertCircle size={20} />
          <span>Configuração pendente: Adicione as chaves do Supabase no arquivo .env para ativar a sincronização.</span>
          <button onClick={() => setShowSettings(true)} style={{ marginLeft: 'auto', background: 'white', color: 'var(--danger)', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Cofigurar</button>
        </div>
      )}

      <header className="header">
        <div>
          <h1 className="fade-in">Leca</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Arquitetura Eficiente Supabase</p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div
            className={`sync-status ${hasCredentials ? (syncPhrase ? 'active' : 'idle') : 'error'} ${isSyncing ? 'syncing' : ''}`}
            onClick={manualSync}
            style={{ cursor: 'pointer' }}
            title={syncPhrase ? (isSyncing ? 'Sincronizando...' : `ID: ${syncPhrase}`) : 'Sem ID'}
          >
            {hasCredentials ? <RefreshCw size={18} className={isSyncing ? 'spin' : ''} /> : <CloudOff size={18} />}
          </div>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="Cloud & Sync">
            <Settings size={22} />
          </button>
          <button className="btn-icon hide-mobile" onClick={() => setViewMode(viewMode === 'table' ? 'cards' : 'table')} title="Layout">
            {viewMode === 'table' ? <LayoutGrid size={22} /> : <List size={22} />}
          </button>
          <button className="btn-icon" onClick={() => setShowHistory(!showHistory)} title="Histórico">
            <History size={22} />
          </button>
          <button className="btn-primary" onClick={() => openModal()} style={{ marginLeft: '0.4rem' }}>
            <Plus size={20} /> <span className="hide-mobile">Novo</span>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in" style={{ maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Cloud size={20} color="var(--primary)" />
                <h2 style={{ margin: 0 }}>Sync Premium</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="btn-icon-tiny"><X size={24} /></button>
            </div>

            {!hasCredentials && (
              <div className="info-box danger">
                <AlertCircle size={20} />
                <p style={{ fontSize: '0.8rem' }}>As chaves do Supabase não foram encontradas. Sincronização offline.</p>
              </div>
            )}

            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Use seu ID para sincronizar hábitos. No modo Supabase, a sincronia é 10x mais rápida e eficiente.
            </p>

            <input
              type="text"
              placeholder="Digite seu Sync ID..."
              defaultValue={syncPhrase}
              onBlur={(e) => saveSyncPhrase(e.target.value)}
              className="sync-input"
            />
            {syncPhrase && (
              <div className={syncPhrase.length >= 4 ? "success-text" : "error-text"}>
                {syncPhrase.length >= 4 ? <ShieldCheck size={16} /> : <AlertCircle size={16} />}
                {syncPhrase.length >= 4 ? `ID Ativo: ${syncPhrase}` : "ID deve ter +4 letras."}
              </div>
            )}

            <div style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', fontSize: '0.8rem' }}>
              <strong>Status:</strong> {hasCredentials ? '✅ Servidor Online' : '❌ Aguardando Credenciais'}<br />
              <strong>Tipo:</strong> Eficiente (LWW Merge)
            </div>

            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }} onClick={() => setShowSettings(false)}>Fechar</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="glass-card fade-in" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: 'var(--primary)' }}>Histórico</h2>
          <div className="stats-grid">
            {history.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', gridColumn: '1/-1' }}>Vazio.</p>
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
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${calculateDailyCompletion(today)}%`, background: 'var(--success)' }}></div>
          </div>
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="stat-label">Total de Hábitos</div>
          <div className="stat-value">{tasks.length}</div>
        </div>
      </div>

      <div className="glass-card fade-in" style={{ padding: viewMode === 'table' ? '0' : '1.5rem' }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            Nenhum hábito. Clique em "Novo"!
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
                  <th style={{ paddingRight: '1.5rem' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ paddingLeft: '1.5rem' }}>
                      <div className="task-name">{task.name}</div>
                      <div className="task-frequency">{task.targetFreq}x</div>
                      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
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
                  <div style={{ display: 'flex', gap: '0.6rem' }}>
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
                          {format(dayDate, 'E', { locale: ptBR })}
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
              <h2>{editingTask ? 'Editar' : 'Novo'}</h2>
              <button onClick={closeModal} className="btn-icon-tiny"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Hábito</label>
              <input type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)} autoFocus placeholder="Ex: Meditação..." />
              <label>Frequência Semanal</label>
              <select value={taskFreq} onChange={(e) => setTaskFreq(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}x por semana</option>)}
              </select>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--border)', flex: 1 }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 2, justifyContent: 'center' }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
