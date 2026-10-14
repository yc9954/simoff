# 이어서 작업하기 (클라우드 세션 → 로컬)

## 지금 상태
- 화면 10개를 스토리보드 보드 마크업 그대로 옮김: `static/screens/<id>.html`(보드의 `<main>` 그대로) + `static/app.js`가 `data-k` / `data-slot` / `data-shot` 자리에 API 값을 채움. 사이드바도 보드 것 그대로(`index.html`), CSS는 보드들의 style 블록 합집합(`static/kit.css`), 폰트는 `static/fonts/`, 셰이더 배경은 `static/vendor/obolus-fx.js`(스토리보드의 Obolus 번들).
- 3D: `static/store3d.js`, three.js 0.180(ESM, `static/vendor/three/`). gs2500(같은 팀)의 `shopper.glb`·`checkout-terminal.glb`를 `static/assets/`로 가져와 씀. 매장은 미터 단위 템플릿(부서별 진열대, 뒤쪽 냉장 쇼케이스, 유리 전면, 계산대 4, 입구 전단대), 통로·부서 비중·진열 자리·시리얼 위치만 데이터. 보기: store / cereal / plan / follow / card. `snapshots()`가 카드용 장면을 실시간 렌더.
- 서버 로그 출력이 오류 요청에서 죽던 버그 고침(`server.py` log_message).

## 확인된 것 (헤드리스 Chromium)
- 10개 화면 모두 콘솔 오류 없이 렌더. 브리프 정리, 다른 방문 재생, 매장 월드 평면·따라가기, 엔진 비교(가구 1804 = 스토리보드 숫자와 같음) 동작.

## 남은 일
1. 브라우저로 다시 확인: 최종 배치의 "시리얼 근접"·상품 선택, 실행의 "다시 실행", 매장 연결의 "예시 파일로 해보기"(약 1–2분), 400px 폰 폭 가로 스크롤 없음. (클라우드에서는 위 로그 버그로 마지막 확인이 끊겼음, 버그는 고침.)
2. `app/README.md`를 새 구조(스크린 템플릿, three 0.180, gs2500 에셋 출처)로 갱신.
3. 실행 화면 엔진 5개(스토리보드는 3개): 평소대로 예측·평균 효과를 접을지 결정.

## 실행
```bash
cd sim && pip install -r requirements.txt
python app/server.py        # http://localhost:8790
```
