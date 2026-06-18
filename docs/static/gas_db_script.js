/**
 * ScoreQuery - Google Apps Script Serverless DB Script
 *
 * 이 스크립트를 구글 스프레드시트의 [확장 프로그램] > [Apps Script]에 복사하여 붙여넣고 웹앱으로 배포하십시오.
 * 웹앱 배포 시 설정:
 *  - 웹앱을 실행할 사용자: 나 (마스터 구글 계정)
 *  - 액세스할 수 있는 사용자: 모든 사용자 (가입 신청자 및 다른 교수자의 브라우저 요청 처리를 위함)
 */

function doPost(e) {
  try {
    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;
    var payload = requestData.payload;
    var auth = requestData.auth; // 마스터 인증 정보: { email, pwHash }
    
    var sheet = getOrCreateUsersSheet();
    initializeMasterIfEmpty(sheet);

    var result;
    if (action === "register") {
      result = handleRegister(sheet, payload);
    } else if (action === "login") {
      result = handleLogin(sheet, payload);
    } else if (action === "get_users") {
      result = handleGetUsers(sheet, auth);
    } else if (action === "approve") {
      result = handleSetStatus(sheet, auth, payload.email, "approved");
    } else if (action === "reject") {
      result = handleSetStatus(sheet, auth, payload.email, "rejected");
    } else if (action === "delete") {
      result = handleSetStatus(sheet, auth, payload.email, "deleted");
    } else if (action === "restore") {
      result = handleSetStatus(sheet, auth, payload.email, "pending");
    } else if (action === "reset_pw") {
      result = handleResetPw(sheet, auth, payload.email, payload.tempPw);
    } else if (action === "change_pw") {
      result = handleChangePw(sheet, auth, payload.newPwHash);
    } else {
      throw new Error("알 수 없는 액션: " + action);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// OPTIONS (Preflight) 요청이 올 경우 대응
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

// "Users" 시트가 없으면 생성하고 헤더 배치
function getOrCreateUsersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Users");
  if (!sheet) {
    sheet = ss.insertSheet("Users");
    sheet.appendRow(["email", "name", "univ", "dept", "pw", "phone", "status", "isMaster", "regDate"]);
    // 보기 좋게 첫 행 고정 및 굵게
    sheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#f1f5f9");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 시트가 헤더만 있을 때 기본 마스터 계정 초기화
function initializeMasterIfEmpty(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    // armour@tu.ac.kr / armour1234
    // armour1234의 SHA-256 해시값: 84668ba4df93b3f27df7a360fde2f72c4ad3d9020970a24c2ed2b144bd3540b6
    sheet.appendRow([
      "armour@tu.ac.kr",
      "서창갑",
      "동명대학교",
      "경영학과",
      "84668ba4df93b3f27df7a360fde2f72c4ad3d9020970a24c2ed2b144bd3540b6",
      "010-9756-5400",
      "approved",
      true,
      new Date().toISOString()
    ]);
  }
}

// 마스터 권한 검증 함수
function validateMasterAuth(sheet, auth) {
  if (!auth || !auth.email || !auth.pwHash) {
    throw new Error("마스터 권한 인증 정보가 누락되었습니다.");
  }
  var users = getAllUsersFromSheet(sheet);
  var masterUser = users.find(function(u) {
    return u.email === auth.email && (u.isMaster === true || u.isMaster === "true");
  });
  if (!masterUser || masterUser.pw !== auth.pwHash) {
    throw new Error("마스터 권한 인증에 실패했습니다.");
  }
  return masterUser;
}

// 시트의 데이터를 객체 배열로 변환
function getAllUsersFromSheet(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  var range = sheet.getRange(2, 1, lastRow - 1, 9);
  var values = range.getValues();
  
  return values.map(function(row) {
    return {
      email: row[0],
      name: row[1],
      univ: row[2],
      dept: row[3],
      pw: row[4],
      phone: row[5],
      status: row[6],
      isMaster: row[7],
      regDate: row[8]
    };
  });
}

// 신규 회원 등록
function handleRegister(sheet, user) {
  var users = getAllUsersFromSheet(sheet);
  
  // 중복 이메일 체크
  var exist = users.find(function(u) {
    return u.email === user.email;
  });
  
  if (exist) {
    if (exist.status === "deleted") {
      // 탈퇴한 계정인 경우 재가입 처리 (기존 행 업데이트)
      var rowIndex = findRowIndexByEmail(sheet, user.email);
      sheet.getRange(rowIndex, 2, 1, 8).setValues([[
        user.name,
        user.univ,
        user.dept,
        user.pw,
        user.phone,
        "pending",
        false,
        new Date().toISOString()
      ]]);
      return { email: user.email, status: "pending" };
    }
    throw new Error("이미 등록되었거나 승인 대기 중인 이메일입니다.");
  }

  // 신규 행 추가
  sheet.appendRow([
    user.email,
    user.name,
    user.univ,
    user.dept,
    user.pw,
    user.phone,
    "pending",
    false,
    new Date().toISOString()
  ]);
  return { email: user.email, status: "pending" };
}

// 로그인 및 최신 가입 정보 조회
function handleLogin(sheet, payload) {
  var users = getAllUsersFromSheet(sheet);
  var user = users.find(function(u) {
    return u.email === payload.email && u.pw === payload.pwHash;
  });
  
  if (!user) {
    throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
  }
  
  // 비밀번호는 제외하고 반환
  var resUser = Object.assign({}, user);
  delete resUser.pw;
  return resUser;
}

// 전체 회원 목록 가져오기 (마스터 전용)
function handleGetUsers(sheet, auth) {
  validateMasterAuth(sheet, auth);
  return getAllUsersFromSheet(sheet);
}

// 가입자 상태 일괄 처리 (승인/반려/삭제)
function handleSetStatus(sheet, auth, email, status) {
  validateMasterAuth(sheet, auth);
  var rowIndex = findRowIndexByEmail(sheet, email);
  if (rowIndex < 2) {
    throw new Error("해당 가입 정보를 찾을 수 없습니다.");
  }
  
  // status 열(7번째 열) 값 수정
  sheet.getRange(rowIndex, 7).setValue(status);
  
  // (선택 사항) 승인 완료 시 메일 발송 트리거
  if (status === "approved") {
    try {
      var userName = sheet.getRange(rowIndex, 2).getValue();
      MailApp.sendEmail({
        to: email,
        subject: "[ScoreQuery] 교수 회원가입 승인 완료 안내",
        body: userName + " 교수님 안녕하십니까,\n\n" +
              "성적 조회 및 관리 시스템(ScoreQuery)의 교수 회원가입 신청이 성공적으로 승인 완료되었음을 알려드립니다.\n\n" +
              "이제 등록하신 교수 이메일(" + email + ")과 설정하신 비밀번호로 로그인하여 시스템에 진입하실 수 있습니다.\n\n" +
              "- 시스템 접속 주소: https://armour-seo.github.io/ScoreQuery/\n\n" +
              "감사합니다.\n" +
              "마스터 서창갑 드림"
      });
    } catch (mailErr) {
      Logger.log("메일 발송 실패: " + mailErr.message);
    }
  }
  
  return { email: email, status: status };
}

// 비밀번호 초기화 처리
function handleResetPw(sheet, auth, email, tempPwHash) {
  validateMasterAuth(sheet, auth);
  var rowIndex = findRowIndexByEmail(sheet, email);
  if (rowIndex < 2) {
    throw new Error("해당 가입 정보를 찾을 수 없습니다.");
  }
  
  // pw 열(5번째 열) 값 수정
  sheet.getRange(rowIndex, 5).setValue(tempPwHash);
  
  return { email: email, reset: true };
}

// 비밀번호 변경 처리 (자기 자신)
function handleChangePw(sheet, auth, newPwHash) {
  if (!auth || !auth.email || !auth.pwHash) {
    throw new Error("비밀번호 변경 인증 정보가 누락되었습니다.");
  }
  var users = getAllUsersFromSheet(sheet);
  var user = users.find(function(u) {
    return u.email === auth.email;
  });
  if (!user || user.pw !== auth.pwHash) {
    throw new Error("현재 비밀번호 인증에 실패했습니다.");
  }
  
  var rowIndex = findRowIndexByEmail(sheet, auth.email);
  if (rowIndex < 2) {
    throw new Error("해당 계정을 찾을 수 없습니다.");
  }
  
  // pw 열(5번째 열) 값 수정
  sheet.getRange(rowIndex, 5).setValue(newPwHash);
  return { email: auth.email, changed: true };
}

// 이메일로 해당 시트 행(Row Index) 찾기
function findRowIndexByEmail(sheet, email) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var range = sheet.getRange(2, 1, lastRow - 1, 1);
  var values = range.getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === email) {
      return i + 2; // 1-indexed 및 헤더 행 보정
    }
  }
  return -1;
}
