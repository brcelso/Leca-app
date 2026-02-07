// Leca Enterprise - High Performance Habit Tracker | v1.0.1 (Build Trigger)
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Check, Trash2, Edit2, Calendar, Target, TrendingUp, History, X, Save, RefreshCw, Settings, ShieldCheck, AlertCircle, LayoutGrid, List, Info, Database, Cloud, CloudOff, LogOut, User, Activity, CheckCircle2, XCircle } from 'lucide-react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db, migrateData, syncTaskToCloud, syncAllToCloud, fetchAllTasks, generateUUID } from './db';

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];
const WEEK_DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function App() {
  // DB Queries
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const history = useLiveQuery(() => db.history.orderBy('weekStart').reverse().toArray(), []) || [];

  // SAFARI FIX: Safe date parsing helper
  const safeDate = (dateStr) => {
    if (!dateStr) return new Date();
    // Replace SQL space with ISO T, handle invalid strings gracefully
    try {
      return new Date(dateStr.toString().replace(' ', 'T'));
    } catch (e) {
      return new Date();
    }
  };

  const [user, setUser] = useState(JSON.parse(localStorage.getItem('leca_user') || 'null'));
  const [showModal, setShowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskName, setTaskName] = useState('');
  const [taskFreq, setTaskFreq] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [viewMode, setViewMode] = useState(window.innerWidth < 768 ? 'cards' : 'table');
  const [debugOverlay, setDebugOverlay] = useState(null);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    url: import.meta.env.VITE_API_URL,
    health: 'pending',
    db: 'pending',
    userInCloud: 'pending',
    count: 0
  });

  const runDiagnostics = async (currentEmail) => {
    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8787/api').replace('/api', '');
    const emailToSearch = currentEmail || user?.email;

    setDiagnostics(prev => ({ ...prev, health: 'loading', db: 'loading', userInCloud: 'loading' }));

    try {
      // 1. Health Check
      const hRes = await fetch(apiBase);
      const isHealthOk = hRes.ok;
      setDiagnostics(prev => ({ ...prev, health: isHealthOk ? 'ok' : 'fail' }));

      // 2. DB Debug Check
      const dRes = await fetch(`${apiBase}/api/debug`, {
        headers: { 'X-User-Email': emailToSearch || '' }
      });
      if (dRes.ok) {
        const data = await dRes.json();
        // Use the new secure flag 'user_exists' from backend
        const isInCloud = data.stats?.user_exists === true;
        setDiagnostics(prev => ({
          ...prev,
          db: 'ok',
          count: data.stats?.tasks || 0,
          userInCloud: isInCloud ? 'ok' : 'fail'
        }));
      } else {
        setDiagnostics(prev => ({ ...prev, db: 'fail', userInCloud: 'fail' }));
      }
    } catch (e) {
      setDiagnostics(prev => ({ ...prev, health: 'fail', db: 'fail', userInCloud: 'fail' }));
    }
  };

  useEffect(() => {
    console.log('[Leca Diagnostics] API URL:', import.meta.env.VITE_API_URL);
  }, []);

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

  // Google Login Callback
  const handleCredentialResponse = async (response) => {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const newUser = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
    };
    setUser(newUser);
    localStorage.setItem('leca_user', JSON.stringify(newUser));

    // Track login in Cloudflare D1
    try {
      const loginRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8787/api'}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });

      if (loginRes.ok) {
        // Run Proactive Diagnostics
        // setShowTroubleshooter(true); // Auto-open disabled
        runDiagnostics(newUser.email);
      }
    } catch (err) {
      console.error('[Cloud Login Track Failed]', err);
    }
  };

  // Google Script Initialization with Retry
  useEffect(() => {
    let retryCount = 0;
    const initGoogle = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID",
          callback: handleCredentialResponse,
        });
        if (!user) {
          const btnElem = document.getElementById("googleBtn");
          if (btnElem) {
            window.google.accounts.id.renderButton(btnElem, { theme: "outline", size: "large", width: "100%" });
          }
        }
      } else if (retryCount < 10) {
        retryCount++;
        setTimeout(initGoogle, 500); // Retry every 500ms
      }
    };

    initGoogle();
  }, [user]);

  // Self-Healing: Ensure user exists in Cloud DB (for users who logged in before the DB update)
  useEffect(() => {
    if (user && user.email) {
      const ensureCloudRegistration = async () => {
        try {
          await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8787/api'}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
          });
        } catch (e) {
          console.error('Cloud registration retry failed', e);
        }
      };
      ensureCloudRegistration();
    }
  }, [user]);

  // Sync Logic: Periodic Pull and Initial Load
  useEffect(() => {
    const sync = async () => {
      if (!user) return;

      setIsSyncing(true);
      try {
        // 1. Pull remote tasks
        const remoteTasks = await fetchAllTasks(user.email);
        for (const r of remoteTasks) {
          const local = await db.tasks.where('uuid').equals(r.uuid).first();
          const completions = typeof r.completions === 'string' ? JSON.parse(r.completions) : (r.completions || []);

          if (!local) {
            await db.tasks.add({
              uuid: r.uuid,
              name: r.name,
              targetFreq: r.target_freq,
              completions: completions,
              createdAt: r.created_at,
              updatedAt: r.updated_at
            });
          } else {
            const remoteTS = safeDate(r.updated_at || r.created_at).getTime();
            const localTS = safeDate(local.updatedAt || local.createdAt).getTime();

            // Merge completions sets
            const localCompletions = local.completions || [];
            const combined = Array.from(new Set([...localCompletions, ...completions]));

            if (remoteTS > localTS || combined.length > localCompletions.length) {
              await db.tasks.update(local.id, {
                name: r.name,
                targetFreq: r.target_freq,
                completions: combined,
                updatedAt: r.updated_at
              });
            }
          }
        }
        // 2. Push local changes
        await syncAllToCloud(user.email);
      } catch (err) {
        console.error('[Sync Error]', err);
      } finally {
        setTimeout(() => setIsSyncing(false), 800);
      }
    };

    const init = async () => {
      await migrateData();
      await sync();
    };

    init();
    const interval = setInterval(sync, 10000); // Sync every 10s
    return () => clearInterval(interval);
  }, [user]);

  // Weekly score management
  useEffect(() => {
    const handleWeekTransition = async () => {
      const lastWeekStart = localStorage.getItem('leca_last_week_start_v6');
      if (lastWeekStart && lastWeekStart !== currentWeekStartStr) {
        const allTasks = await db.tasks.toArray();
        if (allTasks.length > 0) {
          const score = calculateScore(allTasks, lastWeekStart);
          await db.history.add({ weekStart: lastWeekStart, score });
          for (const task of allTasks) {
            const updated = { completions: [], updatedAt: new Date().toISOString() };
            await db.tasks.update(task.id, updated);
            if (user) syncTaskToCloud({ ...task, ...updated }, user.email);
          }
        }
      }
      localStorage.setItem('leca_last_week_start_v6', currentWeekStartStr);
    };
    handleWeekTransition();
  }, [currentWeekStartStr, user]);

  const logout = () => {
    setUser(null);
    localStorage.removeItem('leca_user');
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
      if (user) syncTaskToCloud({ ...editingTask, ...updated }, user.email);
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
      if (user) syncTaskToCloud({ ...newTask, id }, user.email);
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
    if (user) syncTaskToCloud({ ...task, ...updated }, user.email);
  };

  const deleteTask = async (id) => {
    if (confirm('Excluir este hábito?')) {
      const task = await db.tasks.get(id);
      await db.tasks.delete(id);
      if (user && task) {
        // Soft delete or real delete via API
        fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8787/api'}/tasks/${task.uuid}`, {
          method: 'DELETE',
          headers: { 'X-User-Email': user.email, 'Authorization': 'Bearer local-dev-token' }
        }).catch(err => console.error('[Sync Delete Error]', err));
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

  if (!user) {
    return (
      <div className="login-screen">
        <div className="glass-card login-card fade-in">
          <div className="login-logo">Leca</div>
          <h2>Hábitos em Alta Performance</h2>
          <p>Sincronização Cloudflare + Google Auth</p>
          <div id="googleBtn" style={{ marginTop: '2rem' }}></div>
          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => { setShowTroubleshooter(true); runDiagnostics(); }} style={{ fontSize: '0.8rem', padding: '0.5rem' }}>
              <Activity size={14} style={{ marginRight: '0.5rem' }} /> Testar Conexão Cloud
            </button>
            <button className="btn-secondary" onClick={() => setUser({ name: 'Dev User', email: 'dev@leca.app', picture: '' })} style={{ opacity: 0.5, fontSize: '0.7rem' }}>Entrar modo Dev (Sem Google)</button>
          </div>
        </div>

        {/* Troubleshooter available on Login Screen */}
        {showTroubleshooter && (
          <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <div className="glass-card fade-in" style={{ maxWidth: '450px', padding: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Activity className="text-primary" size={24} />
                  <h2 style={{ margin: 0 }}>Cloud Connection Center</h2>
                </div>
                <button onClick={() => setShowTroubleshooter(false)} className="btn-icon-tiny"><X size={24} /></button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="troubleshoot-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Endereço do Servidor</span>
                    <code style={{ fontSize: '0.7rem', opacity: 0.6 }}>{diagnostics.url?.replace('https://', '')}</code>
                  </div>
                </div>

                <div className="troubleshoot-check">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {diagnostics.health === 'loading' ? <RefreshCw className="spin" size={18} /> :
                      diagnostics.health === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                    <span>Status do Servidor (Health)</span>
                  </div>
                </div>

                <div className="troubleshoot-check">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {diagnostics.db === 'loading' ? <RefreshCw className="spin" size={18} /> :
                      diagnostics.db === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                    <span>Conexão com Banco de Dados (D1)</span>
                  </div>
                </div>

                <div className="troubleshoot-check">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {diagnostics.userInCloud === 'loading' ? <RefreshCw className="spin" size={18} /> :
                      diagnostics.userInCloud === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                    <span>Seu Login está salvo na Nuvem?</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', marginTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Total de Tarefas no Banco:</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{diagnostics.count}</span>
                  </div>
                </div>

                <button className="btn-primary" onClick={() => runDiagnostics()} style={{ marginTop: '1rem' }}>
                  <RefreshCw size={16} style={{ marginRight: '0.5rem' }} /> Re-testar Agora
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="user-avatar">
            {user.picture ? <img src={user.picture} alt={user.name} /> : <User size={20} />}
          </div>
          <div>
            <h1 className="fade-in">Leca</h1>
            <p style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}>{user.name} (Cloud Active)</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div
            className={`sync-status active ${isSyncing ? 'syncing' : ''}`}
            onClick={async () => {
              setIsSyncing(true);
              try {
                await runDiagnostics();
                setShowTroubleshooter(true);
                await syncAllToCloud(user.email);
              } catch (e) { console.error(e); }
              setIsSyncing(false);
            }}
            style={{ cursor: 'pointer' }}
            title="Centro de Conexão Cloud"
          >
            <ShieldCheck size={18} />
          </div>
          <a
            href={`${import.meta.env.VITE_API_URL}/debug`}
            target="_blank"
            rel="noreferrer"
            className="btn-icon"
            title="Debug Database"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Database size={20} />
          </a>
          <button className="btn-icon" onClick={logout} title="Sair">
            <LogOut size={22} />
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

      {showHistory && (
        <div className="glass-card fade-in" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: 'var(--primary)' }}>Histórico</h2>
          <div className="stats-grid">
            {history.length === 0 ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', gridColumn: '1/-1' }}>Vazio.</p> : history.map((h) => (
              <div key={h.id} className="glass-card" style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Semana {format(safeDate(h.weekStart), 'dd/MM')}</span>
                  <span style={{ color: 'var(--success)', fontWeight: 700 }}>{h.score}%</span>
                </div>
                <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${h.score}%` }}></div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="glass-card stat-card fade-in">
          <div className="stat-label">Progresso Semanal</div>
          <div className="stat-value">{totalScore}%</div>
          <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${totalScore}%` }}></div></div>
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="stat-label">Cofrequência Hoje</div>
          <div className="stat-value">{calculateDailyCompletion(today)}%</div>
          <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${calculateDailyCompletion(today)}%`, background: 'var(--success)' }}></div></div>
        </div>
        <div className="glass-card stat-card fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="stat-label">Total de Hábitos</div>
          <div className="stat-value">{tasks.length}</div>
        </div>
      </div>

      <div className="glass-card fade-in" style={{ padding: viewMode === 'table' ? '0' : '1.5rem' }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>Nenhum hábito ainda.</div>
        ) : viewMode === 'table' ? (
          <div className="task-table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingLeft: '2rem' }}>Hábito</th>
                  {DAYS_OF_WEEK.map(d => <th key={d}>{WEEK_DAYS_SHORT[d]} {format(addDays(currentWeekStart, d), 'dd/MM')}</th>)}
                  <th style={{ paddingRight: '2rem' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ paddingLeft: '2rem' }}>
                      <div className="task-name">{task.name}</div>
                      <div className="task-frequency">{task.targetFreq}x semana</div>
                      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
                        <button onClick={() => openModal(task)} className="btn-icon-tiny"><Edit2 size={13} /></button>
                        <button onClick={() => deleteTask(task.id)} className="btn-icon-tiny" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                    {DAYS_OF_WEEK.map(d => {
                      const dayDate = addDays(currentWeekStart, d);
                      const isDone = (task.completions || []).includes(format(dayDate, 'yyyy-MM-dd'));
                      return <td key={d}><div className={`checkbox-day ${isDone ? 'checked' : ''}`} onClick={() => toggleDay(task, dayDate)}>{isDone && <Check size={16} color="white" />}</div></td>;
                    })}
                    <td style={{ textAlign: 'center', paddingRight: '2rem', fontWeight: 700, color: 'var(--primary)' }}>{calculateWeeklyProgress(task)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {tasks.map(task => (
              <div key={task.id} className="glass-card" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div><div className="task-name" style={{ fontSize: '1.1rem' }}>{task.name}</div><div className="task-frequency">{task.targetFreq}x</div></div>
                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button onClick={() => openModal(task)} className="btn-icon-tiny"><Edit2 size={18} /></button>
                    <button onClick={() => deleteTask(task.id)} className="btn-icon-tiny" style={{ color: 'var(--danger)' }}><Trash2 size={18} /></button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem', marginBottom: '1rem' }}>
                  {DAYS_OF_WEEK.map(d => {
                    const dayDate = addDays(currentWeekStart, d);
                    const isDone = (task.completions || []).includes(format(dayDate, 'yyyy-MM-dd'));
                    return (
                      <div key={d} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>{WEEK_DAYS_SHORT[d]} {format(dayDate, 'dd/MM')}</div>
                        <div className={`checkbox-day ${isDone ? 'checked' : ''}`} style={{ width: '100%', height: '36px' }} onClick={() => toggleDay(task, dayDate)}>{isDone && <Check size={18} color="white" />}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="progress-bar-container" style={{ flex: 1, marginRight: '1rem', marginTop: 0 }}><div className="progress-bar" style={{ width: `${calculateWeeklyProgress(task)}%` }}></div></div>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary)' }}>{calculateWeeklyProgress(task)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTroubleshooter && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="glass-card fade-in" style={{ maxWidth: '450px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity className="text-primary" size={24} />
                <h2 style={{ margin: 0 }}>Cloud Connection Center</h2>
              </div>
              <button onClick={() => setShowTroubleshooter(false)} className="btn-icon-tiny"><X size={24} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="troubleshoot-item">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Endereço do Servidor</span>
                  <code style={{ fontSize: '0.7rem', opacity: 0.6 }}>{diagnostics.url?.replace('https://', '')}</code>
                </div>
              </div>

              <div className="troubleshoot-check">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  {diagnostics.health === 'loading' ? <RefreshCw className="spin" size={18} /> :
                    diagnostics.health === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                  <span>Status do Servidor (Health)</span>
                </div>
              </div>

              <div className="troubleshoot-check">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  {diagnostics.db === 'loading' ? <RefreshCw className="spin" size={18} /> :
                    diagnostics.db === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                  <span>Conexão com Banco de Dados (D1)</span>
                </div>
              </div>

              <div className="troubleshoot-check">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  {diagnostics.userInCloud === 'loading' ? <RefreshCw className="spin" size={18} /> :
                    diagnostics.userInCloud === 'ok' ? <CheckCircle2 size={18} color="var(--success)" /> : <XCircle size={18} color="var(--danger)" />}
                  <span>Seu Login está salvo na Nuvem?</span>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>Total de Tarefas no Banco:</span>
                  <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{diagnostics.count}</span>
                </div>
              </div>

              <button className="btn-primary" onClick={() => runDiagnostics()} style={{ marginTop: '1rem' }}>
                <RefreshCw size={16} style={{ marginRight: '0.5rem' }} /> Re-testar Agora
              </button>
            </div>
          </div>
        </div>
      )}

      {debugOverlay && (
        <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.8)' }}>
          <div className="glass-card fade-in" style={{ maxWidth: '400px', padding: '2rem', textAlign: 'left', border: '1px solid var(--success)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', marginBottom: '1rem' }}>
              <ShieldCheck size={24} />
              <h3 style={{ margin: 0 }}>Login Verificado na Nuvem!</h3>
            </div>
            <p style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '1rem' }}>Validando persistência real no Cloudflare D1...</p>
            <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', fontSize: '0.7rem', overflow: 'auto', maxHeight: '200px', color: '#a0aec0' }}>
              {JSON.stringify(debugOverlay, null, 2)}
            </pre>
            <button className="btn-primary" style={{ marginTop: '1.5rem', width: '100%' }} onClick={() => setDebugOverlay(null)}>Entendido</button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>{editingTask ? 'Editar' : 'Novo Hábito'}</h2>
              <button onClick={closeModal} className="btn-icon-tiny"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Nome do Hábito</label>
              <input type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)} autoFocus />
              <label>Frequência Semanal</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTaskFreq(n)}
                    style={{
                      flex: 1,
                      minWidth: '40px',
                      padding: '0.8rem 0',
                      borderRadius: '8px',
                      background: taskFreq === n ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                      border: taskFreq === n ? '1px solid var(--primary)' : '1px solid var(--border)',
                      color: taskFreq === n ? 'white' : 'var(--text-muted)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {n}x
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--border)', flex: 1 }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 2 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
