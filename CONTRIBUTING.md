# PR 올리는 법

`main`에는 직접 올릴 수 없습니다. **브랜치에서 작업 → PR → 팀장 승인 → 머지** 순서입니다.
처음이면 아래를 위에서부터 따라 하면 됩니다. GitHub Desktop이나 VS Code의 Git 화면을 써도 순서는 같습니다.

## 처음 한 번

```bash
git clone https://github.com/lc-moon/26_2_AICapstone_service.git
cd 26_2_AICapstone_service
```

팀장이 보낸 초대(GitHub 알림 또는 메일)를 먼저 수락해야 push할 수 있습니다.

## 할 일 하나마다

**1. 최신 `main`에서 브랜치 만들기**

```bash
git switch main
git pull
git switch -c server/ingest-api
```

브랜치 이름은 `server/…`(A) 또는 `web/…`(B) 뒤에 무엇을 하는지 짧게. 예: `server/frames-latest`, `web/first-screen`

**2. 작업하고 커밋하기** — 중간중간 여러 번 해도 됩니다

```bash
git add server/
git commit -m "추정값 수신 API 추가"
```

- 커밋 메시지는 무엇을 했는지 한 줄이면 됩니다
- `.env`(인증키)는 절대 올리지 않습니다. `.gitignore`에 들어 있어 `git add .`을 해도 빠지지만, `git status`로 한 번 확인하세요

**3. 올리고 PR 만들기**

```bash
git push -u origin server/ingest-api
```

push하면 GitHub 저장소 페이지에 **Compare & pull request** 버튼이 뜹니다. 누르고 양식을 채워 PR을 만듭니다.

**4. 피드백 반영** — 팀장이 PR에 댓글을 달면, 같은 브랜치에서 고쳐 커밋하고 `git push`만 하면 PR에 자동으로 붙습니다.

**5. 머지된 뒤** — 팀장이 머지하면 GitHub의 브랜치는 자동으로 지워집니다. 다음 할 일은 1번부터 다시.

## 지키면 편한 것

- **PR은 작게 자주.** 할 일 체크리스트 한두 개씩이 리뷰도 빠릅니다
- A는 `server/`만, B는 `web/`만 고칩니다. `shared/`는 고치지 않습니다
- 다른 사람이 먼저 머지해서 충돌이 나면 `git switch main && git pull && git switch 내브랜치 && git merge main`으로 합치고 고칩니다. 막히면 PR에 적어 주세요
