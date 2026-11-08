# TCDD — Test × CodeReview Driven Development

사소하지 않은 코드 변경에는 TCDD를 따른다.

- 스킬: `~/.claude/skills/tcdd-test-codereview-driven-development/SKILL.md`
- 동반: `~/.claude/skills/freebuff-post-change-review/SKILL.md`

기본 완료 조건은 다음과 같다.

```text
테스트 통과 AND 현재 묶음의 Solar Pro 4 Freebuff 검토 완료 -> DONE
```

검토 전에 모델을 고정한다.

```text
python3 ~/.claude/skills/tcdd-test-codereview-driven-development/scripts/set_freebuff_solar_pro4.py
python3 ~/.claude/skills/tcdd-test-codereview-driven-development/scripts/verify_freebuff_solar_pro4.py
```

## 사용자의 명시적 검토 생략 예외

사용자가 현재 변경 묶음에 대해 명시적으로 Freebuff 또는 코드 검토를 건너뛰라고 요청하면 검토 관문을 생략할 수 있다.

- 테스트 관문은 생략하지 않는다.
- 최종 보고에 `사용자 요청으로 Freebuff 검토 생략`이라고 명시한다.
- 검토 생략은 해당 변경 묶음에만 적용하며 이후 변경에 자동으로 이어서 적용하지 않는다.
- 사용자가 배포를 요청한 경우 테스트가 통과했다면 검토 없이 배포할 수 있다.

Freebuff를 사용할 수 없고 사용자의 명시적 생략 요청도 없다면, 그 사실을 알리고 검토 없이 DONE이라고 말하지 않는다.
