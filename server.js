const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// 보안 HTTP 헤더 설정 (helmet)
app.use(helmet({
  contentSecurityPolicy: false, // EJS 템플릿 및 외부 리소스(CDN 등) 사용 시 필요에 따라 조정
}));

// 배포 환경(HTTPS 프록시)에서 secure 쿠키 사용 시 필수 설정
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'badminton-secure-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// 한국 시간(KST, UTC+9) ISO 문자열 생성 헬퍼 함수
function getKSTISOString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstTime = new Date(utc + (9 * 60 * 60 * 1000));
  return kstTime.toISOString().replace('Z', '+09:00');
}

const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('데이터베이스 연결 실패:', err.message);
  } else {
    console.log('SQLite 파일 DB 연결 성공 (database.sqlite)');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS meetups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      date TEXT,
      location TEXT,
      courtCount INTEGER,
      maxPeople TEXT,
      fee TEXT,
      note TEXT,
      status TEXT,
      creatorId INTEGER
    )`);

    db.all(`PRAGMA table_info(meetups)`, [], (err, columns) => {
      if (!err && columns && !columns.some(c => c.name === 'creatorId')) {
        db.run(`ALTER TABLE meetups ADD COLUMN creatorId INTEGER`);
      }
    });

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      name TEXT,
      age INTEGER,
      carrot_nickname TEXT,
      gender TEXT,
      role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meetup_id INTEGER,
      name TEXT,
      gender TEXT,
      level TEXT,
      attended INTEGER,
      duoPartnerId INTEGER,
      duoRemainingGames INTEGER,
      FOREIGN KEY(meetup_id) REFERENCES meetups(id)
    )`);

    db.all(`PRAGMA table_info(members)`, [], (err, columns) => {
      if (!err && columns) {
        if (!columns.some(c => c.name === 'duoPartnerId')) {
          db.run(`ALTER TABLE members ADD COLUMN duoPartnerId INTEGER`);
        }
        if (!columns.some(c => c.name === 'duoRemainingGames')) {
          db.run(`ALTER TABLE members ADD COLUMN duoRemainingGames INTEGER`);
        }
      }
    });

    db.run(`CREATE TABLE IF NOT EXISTS courts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meetup_id INTEGER,
      courtNum INTEGER,
      name TEXT,
      status TEXT,
      teamA_p1 TEXT,
      teamA_p2 TEXT,
      teamB_p1 TEXT,
      teamB_p2 TEXT,
      FOREIGN KEY(meetup_id) REFERENCES meetups(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meetup_id INTEGER,
      courtId INTEGER,
      teamA_p1 TEXT,
      teamA_p2 TEXT,
      teamB_p1 TEXT,
      teamB_p2 TEXT,
      teamA_score INTEGER,
      teamB_score INTEGER,
      winner TEXT,
      playedAt TEXT,
      FOREIGN KEY(meetup_id) REFERENCES meetups(id),
      FOREIGN KEY(courtId) REFERENCES courts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meetup_id INTEGER,
      sender_name TEXT,
      sender_nickname TEXT,
      message TEXT,
      created_at TEXT,
      FOREIGN KEY(meetup_id) REFERENCES meetups(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS global_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT,
      sender_nickname TEXT,
      message TEXT,
      created_at TEXT
    )`);

    db.get(`SELECT COUNT(*) as count FROM meetups`, (err, row) => {
      if (row && row.count === 0) {
        db.run(`INSERT INTO meetups (id, title, date, location, courtCount, maxPeople, fee, note, status, creatorId) VALUES 
          (1, '안산 중앙공원 정기 모임', '2026-08-12 19:00', '안산중앙공원배드민턴장', 3, '24', '0원', '공유 셔틀콕 사용합니다.', 'recruiting', NULL)
        `);
      }
    });

    db.get(`SELECT COUNT(*) as count FROM users`, async (err, row) => {
      if (row && row.count === 0) {
        const sampleFirstNames = ['서준', '도윤', '시우', '예준', '하준', '주원', '지호', '지후', '준우', '민준', '서연', '서윤', '지우', '서현', '하은', '하윤', '민서', '지유', '채원', '지아', '민수', '현우', '성민', '준호', '동현', '영호', '민영', '수진', '은지', '유진'];
        const levels = ['S조', 'A조', 'B조', 'C조', 'D조', '초심'];
        const genders = ['남', '여'];

        console.log('🏸 가상 회원 30명 데이터 생성을 시작합니다...');
        const hashedPassword = bcrypt.hashSync('1234', 10);
        
        for (let i = 0; i < 30; i++) {
          const username = `user${i + 1}`;
          const name = sampleFirstNames[i] || `회원${i + 1}`;
          const age = 20 + (i % 20);
          const carrot_nickname = `당근마켓닉네임${i + 1}`;
          const gender = genders[i % 2];
          const role = (i === 0) ? 'master' : 'member';

          db.run(`INSERT OR IGNORE INTO users (username, password, name, age, carrot_nickname, gender, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, name, age, carrot_nickname, gender, role], (err) => {
              if (!err) {
                const attended = (i < 16) ? 1 : 0;
                const level = levels[i % levels.length];
                db.run(`INSERT OR IGNORE INTO members (meetup_id, name, gender, level, attended, duoPartnerId, duoRemainingGames) VALUES (1, ?, ?, ?, ?, null, null)`,
                  [name, gender, level, attended]
                );
              }
            }
          );
        }
        console.log('✨ 가상 회원 30명 생성 완료!');
      }
    });
  });
}

function canManageMeetup(user, meetup) {
  if (!user || !meetup) return false;
  if (user.role === 'master' || user.role === 'admin') return true;
  return meetup.creatorId != null && meetup.creatorId === user.id;
}

function getCombinations(arr, selectNumber) {
  const results = [];
  if (selectNumber === 1) return arr.map(value => [value]);
  arr.forEach((fixed, index, origin) => {
    const rest = origin.slice(index + 1);
    const combinations = getCombinations(rest, selectNumber - 1);
    const attached = combinations.map(combination => [fixed, ...combination]);
    results.push(...attached);
  });
  return results;
}

function computeAllStats(matches) {
  const map = {};
  const ensure = (name) => {
    if (!map[name]) map[name] = { name, wins: 0, losses: 0, mmr: 1000 };
    return map[name];
  };

  matches.forEach(m => {
    const teamA = [m.teamA_p1, m.teamA_p2].filter(p => p && p !== '-');
    const teamB = [m.teamB_p1, m.teamB_p2].filter(p => p && p !== '-');
    teamA.forEach(ensure);
    teamB.forEach(ensure);

    const diff = Math.abs((m.teamA_score || 0) - (m.teamB_score || 0));
    const winBonus = 20 + diff;
    const loseLoss = 15;

    if (m.winner === 'A') {
      teamA.forEach(n => { map[n].wins++; map[n].mmr += winBonus; });
      teamB.forEach(n => { map[n].losses++; map[n].mmr -= loseLoss; });
    } else if (m.winner === 'B') {
      teamB.forEach(n => { map[n].wins++; map[n].mmr += winBonus; });
      teamA.forEach(n => { map[n].losses++; map[n].mmr -= loseLoss; });
    }
  });

  return Object.values(map).map(p => {
    const total = p.wins + p.losses;
    const winRate = total > 0 ? ((p.wins / total) * 100).toFixed(1) : '0.0';
    return { ...p, total, winRate };
  });
}

function computePartnerStats(matches, myName) {
  if (!myName) return [];
  const partnerMap = {};

  matches.forEach(m => {
    const teamA = [m.teamA_p1, m.teamA_p2].filter(p => p && p !== '-');
    const teamB = [m.teamB_p1, m.teamB_p2].filter(p => p && p !== '-');

    let myTeam = null;
    let partner = null;

    if (teamA.includes(myName)) {
      myTeam = 'A';
      partner = teamA.find(p => p !== myName);
    } else if (teamB.includes(myName)) {
      myTeam = 'B';
      partner = teamB.find(p => p !== myName);
    }

    if (partner && partner !== '-') {
      if (!partnerMap[partner]) {
        partnerMap[partner] = { partner, wins: 0, losses: 0 };
      }
      const isWin = (myTeam === m.winner);
      if (isWin) {
        partnerMap[partner].wins++;
      } else {
        partnerMap[partner].losses++;
      }
    }
  });

  return Object.values(partnerMap).map(p => {
    const total = p.wins + p.losses;
    const winRate = total > 0 ? ((p.wins / total) * 100).toFixed(1) : '0.0';
    return { ...p, total, winRate };
  }).sort((a, b) => Number(b.winRate) - Number(a.winRate) || b.total - a.total);
}

// 회원가입 (비밀번호 해시 적용)
app.post('/auth/signup', async (req, res) => {
  const { username, password, name, age, carrot_nickname, gender } = req.body;
  if (!username || !password || !name) {
    req.session.toast = '필수 정보를 모두 입력해주세요.';
    return res.redirect('/?view=auth&authTab=signup');
  }

  const role = (username === 'wjcho4293') ? 'master' : 'member';

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, name, age, carrot_nickname, gender, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, hashedPassword, name, age, carrot_nickname, gender, role], (err) => {
        if (err) {
          req.session.toast = '이미 존재하는 아이디이거나 회원가입 실패입니다.';
          return res.redirect('/?view=auth&authTab=signup');
        }
        db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
          req.session.user = user;
          req.session.toast = `${user.name}님 환영합니다!`;
          res.redirect('/?tab=profile');
        });
      }
    );
  } catch (error) {
    req.session.toast = '회원가입 처리 중 오류가 발생했습니다.';
    return res.redirect('/?view=auth&authTab=signup');
  }
});

// 로그인 (비밀번호 비교 검증 적용)
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.session.toast = '아이디와 비밀번호를 입력해주세요.';
    return res.redirect('/?view=auth&authTab=login');
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) {
      req.session.toast = '아이디나 비밀번호가 일치하지 않습니다.';
      return res.redirect('/?view=auth&authTab=login');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.session.toast = '아이디나 비밀번호가 일치하지 않습니다.';
      return res.redirect('/?view=auth&authTab=login');
    }

    req.session.user = user;
    req.session.toast = `${user.name}님 환영합니다!`;
    res.redirect('/?tab=profile');
  });
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/?view=auth&authTab=login&toast=' + encodeURIComponent('로그아웃 되었습니다.'));
  });
});

app.post('/meetups/:meetupId/join', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser) {
    req.session.toast = '로그인이 필요합니다.';
    return res.redirect('/?view=auth');
  }
  const meetupId = req.params.meetupId;
  const backTo = req.body.redirectView === 'meetup_detail'
    ? `/?meetupId=${meetupId}&view=meetup_detail`
    : `/?meetupId=${meetupId}&tab=courts`;

  db.get(`SELECT * FROM members WHERE meetup_id = ? AND name = ?`, [meetupId, currentUser.name], (err, row) => {
    if (row) {
      return res.redirect(`${backTo}&toast=` + encodeURIComponent('이미 참여 중인 모임입니다.'));
    }
    db.run(`INSERT INTO members (meetup_id, name, gender, level, attended, duoPartnerId, duoRemainingGames) VALUES (?, ?, ?, '초심', 0, null, null)`,
      [meetupId, currentUser.name, currentUser.gender || '남'], () => {
        res.redirect(`${backTo}&toast=` + encodeURIComponent('모임에 성공적으로 참여했습니다!'));
      }
    );
  });
});

app.post('/meetups/:meetupId/leave', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser) {
    req.session.toast = '로그인이 필요합니다.';
    return res.redirect('/?view=auth');
  }
  const meetupId = req.params.meetupId;
  const backTo = req.body.redirectView === 'meetup_detail'
    ? `/?meetupId=${meetupId}&view=meetup_detail`
    : `/?meetupId=${meetupId}&tab=courts`;

  db.run(`DELETE FROM members WHERE meetup_id = ? AND name = ?`, [meetupId, currentUser.name], () => {
    res.redirect(`${backTo}&toast=` + encodeURIComponent('모임에서 나갔습니다.'));
  });
});

app.post('/meetups/:meetupId/delete', (req, res) => {
  const currentUser = req.session.user;
  const meetupId = req.params.meetupId;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&view=meetup_detail&toast=` + encodeURIComponent('권한이 없습니다. 마스터/관리자/모임장만 삭제할 수 있습니다.'));
    }

    db.serialize(() => {
      db.run(`DELETE FROM members WHERE meetup_id = ?`, [meetupId]);
      db.run(`DELETE FROM courts WHERE meetup_id = ?`, [meetupId]);
      db.run(`DELETE FROM matches WHERE meetup_id = ?`, [meetupId]);
      db.run(`DELETE FROM chats WHERE meetup_id = ?`, [meetupId]);
      db.run(`DELETE FROM meetups WHERE id = ?`, [meetupId], () => {
        res.redirect(`/?tab=list&toast=` + encodeURIComponent('모임이 성공적으로 삭제되었습니다.'));
      });
    });
  });
});

app.post('/meetups/:meetupId/chats', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser) {
    req.session.toast = '로그인이 필요합니다.';
    return res.redirect('/?view=auth');
  }
  const meetupId = req.params.meetupId;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.redirect(`/?meetupId=${meetupId}&view=chat&toast=` + encodeURIComponent('메시지를 입력해주세요.'));
  }

  // 한국 시간(KST)으로 시간 설정
  const now = getKSTISOString();
  db.run(`INSERT INTO chats (meetup_id, sender_name, sender_nickname, message, created_at) VALUES (?, ?, ?, ?, ?)`,
    [meetupId, currentUser.name, currentUser.carrot_nickname || currentUser.name, message.trim(), now], () => {
      res.redirect(`/?meetupId=${meetupId}&view=chat`);
    }
  );
});

app.post('/global-chats', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser) {
    req.session.toast = '로그인이 필요합니다.';
    return res.redirect('/?tab=global_chat');
  }
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.redirect('/?tab=global_chat&toast=' + encodeURIComponent('메시지를 입력해주세요.'));
  }

  // 한국 시간(KST)으로 시간 설정
  const now = getKSTISOString();
  db.run(`INSERT INTO global_chats (sender_name, sender_nickname, message, created_at) VALUES (?, ?, ?, ?)`,
    [currentUser.name, currentUser.carrot_nickname || currentUser.name, message.trim(), now], () => {
      res.redirect('/?tab=global_chat');
    }
  );
});

app.post('/admin/users/:userId/role', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser || currentUser.role !== 'master') {
    return res.redirect('/?view=member_management&toast=' + encodeURIComponent('권한이 없습니다. 마스터만 변경할 수 있습니다.'));
  }

  const targetUserId = req.params.userId;
  const { role } = req.body;

  db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, targetUserId], (err) => {
    if (err) {
      return res.redirect('/?view=member_management&toast=' + encodeURIComponent('권한 변경 실패'));
    }
    res.redirect('/?view=member_management&toast=' + encodeURIComponent('회원 권한이 성공적으로 변경되었습니다.'));
  });
});

app.post('/admin/reset-all-mmr', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser || currentUser.role !== 'master') {
    return res.redirect('/?view=member_management&toast=' + encodeURIComponent('권한이 없습니다. 마스터만 MMR을 초기화할 수 있습니다.'));
  }

  db.run(`DELETE FROM matches`, (err) => {
    if (err) {
      return res.redirect('/?view=member_management&toast=' + encodeURIComponent('MMR 초기화 중 오류가 발생했습니다.'));
    }
    res.redirect('/?view=member_management&toast=' + encodeURIComponent('모든 회원의 MMR과 경기 기록이 성공적으로 초기화되었습니다!'));
  });
});

app.post('/meetups/:meetupId/members/set-duo', (req, res) => {
  const { meetupId } = req.params;
  const currentUser = req.session.user;
  let { selectedMembers } = req.body;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('권한이 없습니다.'));
    }

    if (!selectedMembers) {
      return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('선택된 회원이 없습니다.'));
    }

    if (!Array.isArray(selectedMembers)) {
      selectedMembers = [selectedMembers];
    }

    if (selectedMembers.length !== 2) {
      return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('고정 파트너는 정확히 2명을 선택해야 합니다.'));
    }

    const id1 = Number(selectedMembers[0]);
    const id2 = Number(selectedMembers[1]);
    const defaultDuoGames = 3;

    db.serialize(() => {
      db.run(`UPDATE members SET duoPartnerId = NULL, duoRemainingGames = NULL WHERE id = ? OR id = ?`, [id1, id2], () => {
        db.run(`UPDATE members SET duoPartnerId = ?, duoRemainingGames = ? WHERE id = ?`, [id2, defaultDuoGames, id1]);
        db.run(`UPDATE members SET duoPartnerId = ?, duoRemainingGames = ? WHERE id = ?`, [id1, defaultDuoGames, id2], () => {
          res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('고정 파트너가 성공적으로 지정되었습니다. (3경기 유지)'));
        });
      });
    });
  });
});

app.post('/meetups/:meetupId/members/:memberId/clear-duo', (req, res) => {
  const { meetupId, memberId } = req.params;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('권한이 없습니다.'));
    }
    db.get(`SELECT duoPartnerId FROM members WHERE id = ?`, [memberId], (err, row) => {
      if (row && row.duoPartnerId) {
        db.run(`UPDATE members SET duoPartnerId = NULL, duoRemainingGames = NULL WHERE id = ? OR id = ?`, [memberId, row.duoPartnerId], () => {
          res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('파트너 관계가 해제되었습니다.'));
        });
      } else {
        res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('설정된 파트너가 없습니다.'));
      }
    });
  });
});

app.post('/meetups/:meetupId/courts/:courtId/score', (req, res) => {
  const { meetupId, courtId } = req.params;
  const { teamA_score, teamB_score } = req.body;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('권한이 없습니다.'));
    }

    db.get(`SELECT * FROM courts WHERE id = ?`, [courtId], (err, court) => {
      if (!court || court.status !== 'playing') {
        return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('진행 중인 코트가 아닙니다.'));
      }

      const aScore = Number(teamA_score) || 0;
      const bScore = Number(teamB_score) || 0;
      const winner = aScore >= bScore ? 'A' : 'B';
      const now = getKSTISOString();

      db.run(`INSERT INTO matches (meetup_id, courtId, teamA_p1, teamA_p2, teamB_p1, teamB_p2, teamA_score, teamB_score, winner, playedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [meetupId, courtId, court.teamA_p1, court.teamA_p2, court.teamB_p1, court.teamB_p2, aScore, bScore, winner, now], () => {
          
          const playersInMatch = [court.teamA_p1, court.teamA_p2, court.teamB_p1, court.teamB_p2].filter(p => p && p !== '-');
          playersInMatch.forEach(playerName => {
            db.get(`SELECT id, duoPartnerId, duoRemainingGames FROM members WHERE meetup_id = ? AND name = ?`, [meetupId, playerName], (err, mem) => {
              if (mem && mem.duoRemainingGames && mem.duoRemainingGames > 0) {
                const newRemaining = mem.duoRemainingGames - 1;
                if (newRemaining <= 0) {
                  db.run(`UPDATE members SET duoPartnerId = NULL, duoRemainingGames = NULL WHERE id = ? OR id = ?`, [mem.id, mem.duoPartnerId]);
                } else {
                  db.run(`UPDATE members SET duoRemainingGames = ? WHERE id = ?`, [newRemaining, mem.id]);
                  if (mem.duoPartnerId) {
                    db.run(`UPDATE members SET duoRemainingGames = ? WHERE id = ?`, [newRemaining, mem.duoPartnerId]);
                  }
                }
              }
            });
          });

          db.run(`UPDATE courts SET status = 'empty', teamA_p1 = '-', teamA_p2 = '-', teamB_p1 = '-', teamB_p2 = '-' WHERE id = ?`, [courtId], () => {
            res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('경기가 종료되고 점수 차이 기반 MMR이 반영되었습니다!'));
          });
        }
      );
    });
  });
});

app.post('/meetups/:meetupId/courts/:courtId/assign', (req, res) => {
  const { meetupId, courtId } = req.params;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('권한이 없습니다.'));
    }

    db.all(`SELECT teamA_p1, teamA_p2, teamB_p1, teamB_p2 FROM courts WHERE meetup_id = ? AND status = 'playing'`, [meetupId], (err, activeCourts) => {
      const playingNames = new Set();
      (activeCourts || []).forEach(c => {
        if (c.teamA_p1 !== '-') playingNames.add(c.teamA_p1);
        if (c.teamA_p2 !== '-') playingNames.add(c.teamA_p2);
        if (c.teamB_p1 !== '-') playingNames.add(c.teamB_p1);
        if (c.teamB_p2 !== '-') playingNames.add(c.teamB_p2);
      });

      db.all(`SELECT * FROM members WHERE meetup_id = ? AND attended = 1`, [meetupId], (err, members) => {
        db.all(`SELECT * FROM matches`, [], (err, allMatches) => {
          const allStats = computeAllStats(allMatches || []);
          const mmrMap = {};
          allStats.forEach(s => { mmrMap[s.name] = s.mmr; });
          const getMMR = (name) => mmrMap[name] !== undefined ? mmrMap[name] : 1000;

          const waitingMembers = (members || []).filter(m => !playingNames.has(m.name)).map(m => ({
            ...m,
            mmr: getMMR(m.name)
          }));

          if (waitingMembers.length < 4) {
            return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('경기를 시작하기에 대기 인원이 부족합니다 (최소 4명 필요).'));
          }

          let teamA_p1 = '-', teamA_p2 = '-', teamB_p1 = '-', teamB_p2 = '-';
          let selectedIds = new Set();

          let foundPair = null;
          for (let m of waitingMembers) {
            if (m.duoPartnerId && m.duoRemainingGames > 0 && !selectedIds.has(m.id)) {
              const partner = waitingMembers.find(p => p.id === m.duoPartnerId);
              if (partner && !selectedIds.has(partner.id)) {
                foundPair = [m, partner];
                break;
              }
            }
          }

          if (foundPair) {
            teamA_p1 = foundPair[0].name;
            teamA_p2 = foundPair[1].name;
            const teamA_avg = (foundPair[0].mmr + foundPair[1].mmr) / 2;

            const remainingWaiting = waitingMembers.filter(m => m.id !== foundPair[0].id && m.id !== foundPair[1].id);

            let bestB_pair = null;
            let minDiff = Infinity;

            for (let i = 0; i < remainingWaiting.length; i++) {
              for (let j = i + 1; j < remainingWaiting.length; j++) {
                const b1 = remainingWaiting[i];
                const b2 = remainingWaiting[j];
                const teamB_avg = (b1.mmr + b2.mmr) / 2;
                const diff = Math.abs(teamA_avg - teamB_avg);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestB_pair = [b1, b2];
                }
              }
            }

            if (bestB_pair) {
              teamB_p1 = bestB_pair[0].name;
              teamB_p2 = bestB_pair[1].name;
            }
          } else {
            let bestMatch = null;
            let minDiff = Infinity;

            const fourCombinations = getCombinations(waitingMembers, 4);

            fourCombinations.forEach(quad => {
              const splits = [
                { a: [quad[0], quad[1]], b: [quad[2], quad[3]] },
                { a: [quad[0], quad[2]], b: [quad[1], quad[3]] },
                { a: [quad[0], quad[3]], b: [quad[1], quad[2]] }
              ];

              splits.forEach(split => {
                const avgA = (split.a[0].mmr + split.a[1].mmr) / 2;
                const avgB = (split.b[0].mmr + split.b[1].mmr) / 2;
                const diff = Math.abs(avgA - avgB);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestMatch = split;
                }
              });
            });

            if (bestMatch) {
              teamA_p1 = bestMatch.a[0].name;
              teamA_p2 = bestMatch.a[1].name;
              teamB_p1 = bestMatch.b[0].name;
              teamB_p2 = bestMatch.b[1].name;
            }
          }

          db.run(`UPDATE courts SET status = 'playing', teamA_p1 = ?, teamA_p2 = ?, teamB_p1 = ?, teamB_p2 = ? WHERE id = ?`,
            [teamA_p1, teamA_p2, teamB_p1, teamB_p2, courtId], () => {
              res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=` + encodeURIComponent('평균 MMR이 균형 있게 맞춘 팀으로 스마트 코트에 투입되었습니다!'));
            }
          );
        });
      });
    });
  });
});

app.get('/', (req, res) => {
  const selectedMeetupId = req.query.meetupId ? Number(req.query.meetupId) : null;
  const activeTab = req.query.tab || 'list';
  const authTab = req.query.authTab || 'login';
  const currentUser = req.session.user || null;
  const currentView = req.query.view || (currentUser ? 'main' : 'auth');
  const matchDateQuery = req.query.matchDate || '';

  // 쿼리 파라미터 또는 세션에 저장된 토스트 메시지 가져오기 (세션 사용 시 일회용 삭제)
  const toast = req.query.toast || req.session.toast || null;
  if (req.session.toast) {
    delete req.session.toast;
  }

  const isCourtSelect = (activeTab === 'courts' && !req.query.meetupId);

  db.all(`SELECT * FROM meetups`, [], (err, meetups) => {
    if (err) return res.status(500).send('DB 오류');

    const list = meetups || [];
    const currentMeetup = selectedMeetupId ? (list.find(m => m.id === selectedMeetupId) || list[0]) : list[0];
    const currentMeetupId = currentMeetup ? currentMeetup.id : 0;

    db.all(`SELECT meetup_id, COUNT(*) as count FROM members GROUP BY meetup_id`, [], (err, memberCounts) => {
      const memberCountMap = {};
      (memberCounts || []).forEach(r => {
        memberCountMap[r.meetup_id] = r.count;
      });

      db.all(`SELECT * FROM members WHERE meetup_id = ?`, [currentMeetupId], (err, members) => {
        db.all(`SELECT * FROM courts WHERE meetup_id = ?`, [currentMeetupId], (err, courts) => {
          db.all(`SELECT * FROM chats WHERE meetup_id = ? ORDER BY id ASC`, [currentMeetupId], (err, chats) => {
            db.all(`SELECT * FROM global_chats ORDER BY id ASC`, [], (err, globalChats) => {
              db.all(`SELECT id, username, name, age, carrot_nickname, gender, role FROM users`, [], (err, allUsers) => {
                const organizer = (currentMeetup && currentMeetup.creatorId)
                  ? (allUsers || []).find(u => u.id === currentMeetup.creatorId) || null
                  : null;
                const canManage = canManageMeetup(currentUser, currentMeetup);

                const joinedQuery = currentUser
                  ? new Promise((resolve) => {
                      db.all(`SELECT DISTINCT meetup_id FROM members WHERE name = ?`, [currentUser.name], (err, rows) => {
                        resolve((rows || []).map(r => r.meetup_id));
                      });
                    })
                  : Promise.resolve([]);

                joinedQuery.then((joinedMeetupIds) => {
                  db.all(`SELECT * FROM matches ORDER BY id DESC`, [], (err, allMatches) => {
                    const matches = allMatches || [];
                    const allStats = computeAllStats(matches);

                    const mmrMap = {};
                    allStats.forEach(s => { mmrMap[s.name] = s.mmr; });

                    const fullRankingList = allStats
                      .filter(s => s.total > 0)
                      .sort((a, b) => b.mmr - a.mmr)
                      .map((s, idx) => ({ rank: idx + 1, ...s }));

                    const rankingList = fullRankingList.slice(0, 5);

                    const myStats = currentUser
                      ? (allStats.find(s => s.name === currentUser.name) || { name: currentUser.name, wins: 0, losses: 0, total: 0, winRate: '0.0', mmr: 1000 })
                      : null;

                    const myRecentMatches = currentUser
                      ? matches.filter(m => [m.teamA_p1, m.teamA_p2, m.teamB_p1, m.teamB_p2].includes(currentUser.name)).slice(0, 5)
                      : [];

                    let myAllMatches = currentUser
                      ? matches.filter(m => [m.teamA_p1, m.teamA_p2, m.teamB_p1, m.teamB_p2].includes(currentUser.name))
                      : [];

                    if (matchDateQuery && currentView === 'my_all_matches') {
                      myAllMatches = myAllMatches.filter(m => m.playedAt && m.playedAt.startsWith(matchDateQuery));
                    }

                    const partnerStats = currentUser ? computePartnerStats(matches, currentUser.name) : [];

                    let filteredMatches = matches;
                    if (matchDateQuery && currentView === 'all_matches') {
                      filteredMatches = matches.filter(m => m.playedAt && m.playedAt.startsWith(matchDateQuery));
                    }

                    res.render('index', {
                      meetups: list,
                      memberCountMap,
                      currentMeetup: selectedMeetupId ? currentMeetup : null,
                      isCourtSelect,
                      organizer,
                      canManage,
                      joinedMeetupIds,
                      members: members || [],
                      courts: courts || [],
                      chats: chats || [],
                      globalChats: globalChats || [],
                      allUsers: allUsers || [],
                      rankingList,
                      fullRankingList,
                      myStats,
                      myRecentMatches,
                      myAllMatches,
                      partnerStats,
                      allMatches: filteredMatches,
                      matchDateQuery,
                      activeTab,
                      currentView,
                      authTab,
                      currentUser,
                      mmrMap,
                      toast
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

app.post('/meetups/create', (req, res) => {
  const currentUser = req.session.user;
  if (!currentUser) {
    req.session.toast = '모임을 개설하려면 로그인이 필요합니다.';
    return res.redirect('/?view=auth');
  }

  const { title, dateValue, timeValue, location, courtCount, maxPeople, fee, note } = req.body;
  const dateStr = `${dateValue} ${timeValue}`;
  const cCount = Number(courtCount) || 2;

  db.run(`INSERT INTO meetups (title, date, location, courtCount, maxPeople, fee, note, status, creatorId) VALUES (?, ?, ?, ?, ?, ?, ?, 'recruiting', ?)`,
    [title, dateStr, location, cCount, maxPeople, fee, note || '', currentUser.id], function(err) {
      if (err) return res.status(500).send('모임 생성 실패');
      const newMeetupId = this.lastID;

      for (let i = 1; i <= cCount; i++) {
        db.run(`INSERT INTO courts (meetup_id, courtNum, name, status, teamA_p1, teamA_p2, teamB_p1, teamB_p2) VALUES (?, ?, ?, 'empty', '-', '-', '-', '-')`,
          [newMeetupId, i, `${i}번 코트`]);
      }

      db.run(`INSERT INTO members (meetup_id, name, gender, level, attended, duoPartnerId, duoRemainingGames) VALUES (?, ?, ?, '초심', 1, null, null)`,
        [newMeetupId, currentUser.name, currentUser.gender || '남'], () => {
          res.redirect(`/?meetupId=${newMeetupId}&tab=courts&toast=` + encodeURIComponent('새로운 모임이 개설되었습니다. (모집중)'));
        }
      );
    }
  );
});

app.post('/meetups/:id/status', (req, res) => {
  const meetupId = req.params.id;
  const { status } = req.body;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=${encodeURIComponent('권한이 없습니다. 마스터/관리자/모임장만 가능합니다.')}`);
    }
    db.run(`UPDATE meetups SET status = ? WHERE id = ?`, [status, meetupId], (err) => {
      const msg = status === 'ongoing' ? '모임이 시작되었습니다!' : '모임이 완료되었습니다.';
      res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=${encodeURIComponent(msg)}`);
    });
  });
});

app.post('/meetups/:meetupId/members/:memberId/attendance', (req, res) => {
  const { meetupId, memberId } = req.params;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=${encodeURIComponent('권한이 없습니다. 마스터/관리자/모임장만 가능합니다.')}`);
    }
    db.get(`SELECT attended FROM members WHERE id = ?`, [memberId], (err, row) => {
      if (err) return res.status(500).send('DB 오류');
      const newStatus = row && row.attended ? 0 : 1;
      db.run(`UPDATE members SET attended = ? WHERE id = ?`, [newStatus, memberId], () => {
        res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=${encodeURIComponent('출석 상태가 변경되었습니다.')}`);
      });
    });
  });
});

app.post('/meetups/:meetupId/members/add', (req, res) => {
  const { meetupId } = req.params;
  const { name, level, gender } = req.body;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=${encodeURIComponent('권한이 없습니다. 마스터/관리자/모임장만 가능합니다.')}`);
    }
    db.run(`INSERT INTO members (meetup_id, name, gender, level, attended, duoPartnerId, duoRemainingGames) VALUES (?, ?, ?, ?, 1, null, null)`,
      [meetupId, name, gender, level], () => {
        res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=${encodeURIComponent('새로운 회원이 등록되고 출석 처리되었습니다.')}`);
      }
    );
  });
});

app.post('/meetups/:meetupId/members/add-user/:userId', (req, res) => {
  const { meetupId, userId } = req.params;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&tab=courts&toast=${encodeURIComponent('권한이 없습니다. 마스터/관리자/모임장만 가능합니다.')}`);
    }
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, targetUser) => {
      if (!targetUser) {
        return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=${encodeURIComponent('회원을 찾을 수 없습니다.')}`);
      }
      db.get(`SELECT * FROM members WHERE meetup_id = ? AND name = ?`, [meetupId, targetUser.name], (err, existing) => {
        if (existing) {
          db.run(`UPDATE members SET attended = 1 WHERE id = ?`, [existing.id], () => {
            res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=${encodeURIComponent(`${targetUser.name}님이 이미 등록되어 있어 출석 처리되었습니다.`)}`);
          });
        } else {
          db.run(`INSERT INTO members (meetup_id, name, gender, level, attended, duoPartnerId, duoRemainingGames) VALUES (?, ?, ?, '초심', 1, null, null)`,
            [meetupId, targetUser.name, targetUser.gender || '남'], () => {
              res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=${encodeURIComponent(`${targetUser.name}님이 모임에 추가 및 출석 처리되었습니다.`)}`);
            }
          );
        }
      });
    });
  });
});

app.post('/meetups/:meetupId/members/:memberId/delete', (req, res) => {
  const { meetupId, memberId } = req.params;
  const currentUser = req.session.user;

  db.get(`SELECT * FROM meetups WHERE id = ?`, [meetupId], (err, meetup) => {
    if (!canManageMeetup(currentUser, meetup)) {
      return res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('권한이 없습니다.'));
    }
    db.run(`DELETE FROM members WHERE id = ? AND meetup_id = ?`, [memberId, meetupId], () => {
      res.redirect(`/?meetupId=${meetupId}&view=admin_attendance&toast=` + encodeURIComponent('회원이 삭제되었습니다.'));
    });
  });
});

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}번에서 실행 중입니다.`);
});